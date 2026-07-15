// PaperFolio for Kobo — 外掛進入點。
// Phase 1(USB):插上 Kobo → 點一下 → 解析 KoboReader.sqlite → 寫進 vault。
// Phase 2(LAN 無線):Obsidian 開著時聽一個埠，Kobo 一鍵推 DB → 同一套引擎 → 寫 vault。

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { randomBytes } from "crypto";
import { App, Notice, Plugin, PluginSettingTab, Setting } from "obsidian";
import {
	PaperFolioSettings,
	DEFAULT_SETTINGS,
	DEFAULT_KOBO_DB_PATH,
	HighlightStyle,
	FilenameFormat,
} from "./settings";
import { StateData, State } from "./state";
import { readBookmarks } from "./parser";
import { runSync, summarize, SyncResult } from "./sync";
import { ChapterCache } from "./epub";
import { Receiver } from "./receiver";
import { t, setLang, LangSetting } from "./i18n";

// 找出本機非內部的 IPv4 位址(給 Kobo 填的 LAN 同步位址)
function lanAddresses(): string[] {
	const out: string[] = [];
	const ifaces = os.networkInterfaces();
	for (const name of Object.keys(ifaces)) {
		for (const ni of ifaces[name] || []) {
			if (ni.family === "IPv4" && !ni.internal) out.push(ni.address);
		}
	}
	return out;
}

interface PluginData {
	settings: PaperFolioSettings;
	syncState: StateData;
	chapterCache: ChapterCache;
}

export default class PaperFolioPlugin extends Plugin {
	settings: PaperFolioSettings = { ...DEFAULT_SETTINGS };
	syncState: StateData = {};
	// USB 同步時從 epub 建的章節快取;供無線模式沿用。持久化在 data.json。
	chapterCache: ChapterCache = {};
	private syncing = false;
	private receiver: Receiver | null = null;

	async onload() {
		await this.loadAll();

		this.addRibbonIcon("book-open", t("ribbon_tooltip"), () => {
			void this.syncNow();
		});

		this.addCommand({
			id: "sync-kobo-highlights",
			name: t("command_sync"),
			callback: () => void this.syncNow(),
		});

		this.addSettingTab(new PaperFolioSettingTab(this.app, this));

		// 若設定啟用無線接收，開機就啟動
		if (this.settings.receiverEnabled) {
			void this.startReceiver();
		}
	}

	onunload() {
		this.stopReceiver();
	}

	private dbPath(): string {
		return this.settings.koboDbPath.trim() || DEFAULT_KOBO_DB_PATH;
	}

	// 掛載卷根目錄(epub 章節 fallback 用):DB 在 <root>/.kobo/KoboReader.sqlite。
	// 非標準路徑(或無線推來的 DB)則回 null，epub fallback 自動跳過。
	private volumeRoot(): string | null {
		const dir = path.dirname(this.dbPath());
		return path.basename(dir) === ".kobo" ? path.dirname(dir) : null;
	}

	// USB 與無線共用的引擎路徑:一份 sqlite 位元組 → 解析 → 寫 vault → 存狀態。
	// volumeRoot 有值(USB)才開 epub 補章節;null(無線)走章節快取。
	async syncFromBytes(
		bytes: Uint8Array,
		volumeRoot: string | null
	): Promise<SyncResult> {
		if (this.syncing) throw new Error(t("err_sync_in_progress"));
		this.syncing = true;
		try {
			const books = await readBookmarks(bytes);
			const state = new State(this.syncState);
			const result = await runSync(
				this.app,
				books,
				this.settings,
				state,
				volumeRoot,
				this.chapterCache
			);
			this.syncState = state.export();
			await this.saveAll();
			return result;
		} finally {
			this.syncing = false;
		}
	}

	async syncNow(): Promise<void> {
		try {
			const dbPath = this.dbPath();
			if (!fs.existsSync(dbPath)) {
				new Notice(t("notice_db_not_found", { path: dbPath }), 8000);
				return;
			}

			// -wal 沒被 checkpoint 時，主檔可能不含最新畫線;提醒但不阻擋。
			try {
				const wal = dbPath + "-wal";
				if (fs.existsSync(wal) && fs.statSync(wal).size > 0) {
					console.warn(
						"PaperFolio: uncheckpointed -wal detected; the latest highlights may not be in the main DB yet. Safely eject the Kobo before syncing."
					);
				}
			} catch (e) {
				/* 忽略 wal 檢查失敗 */
			}

			new Notice(t("notice_parsing"));
			const bytes = new Uint8Array(fs.readFileSync(dbPath));
			const result = await this.syncFromBytes(bytes, this.volumeRoot());
			new Notice(t("notice_result", { msg: summarize(result) }), 8000);
		} catch (err) {
			console.error("PaperFolio sync failed:", err);
			new Notice(
				t("notice_sync_failed", {
					err: err instanceof Error ? err.message : String(err),
				}),
				10000
			);
		}
	}

	// --- 無線接收端生命週期 ---

	newReceiverToken(): string {
		return randomBytes(16).toString("hex");
	}

	async startReceiver(): Promise<void> {
		if (this.receiver) return;
		const rx = new Receiver({
			port: this.settings.receiverPort,
			token: this.settings.receiverToken,
			onSync: async (bytes) => {
				// 無線沒有掛載 epub → volumeRoot=null，章節走快取
				const result = await this.syncFromBytes(bytes, null);
				const msg = summarize(result);
				new Notice(t("notice_wireless_result", { msg }), 8000);
				return msg;
			},
			onError: (err) => {
				console.error("PaperFolio receiver error:", err);
				new Notice(t("notice_receiver_error", { err: err.message }), 8000);
			},
		});
		try {
			await rx.start();
			this.receiver = rx;
			new Notice(
				t("notice_receiver_started", { port: this.settings.receiverPort })
			);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			new Notice(t("notice_receiver_start_failed", { err: msg }), 10000);
		}
	}

	stopReceiver(): void {
		if (this.receiver) {
			this.receiver.stop();
			this.receiver = null;
		}
	}

	async restartReceiver(): Promise<void> {
		this.stopReceiver();
		if (this.settings.receiverEnabled) await this.startReceiver();
	}

	lanSyncUrls(): string[] {
		return lanAddresses().map(
			(ip) => `http://${ip}:${this.settings.receiverPort}/sync`
		);
	}

	private async loadAll(): Promise<void> {
		const data = (await this.loadData()) as Partial<PluginData> | null;
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			data?.settings ?? {}
		);
		setLang(this.settings.language);
		this.syncState = data?.syncState ?? {};
		this.chapterCache = data?.chapterCache ?? {};
	}

	async saveAll(): Promise<void> {
		const data: PluginData = {
			settings: this.settings,
			syncState: this.syncState,
			chapterCache: this.chapterCache,
		};
		await this.saveData(data);
	}
}

class PaperFolioSettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: PaperFolioPlugin) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		const s = this.plugin.settings;
		const save = () => void this.plugin.saveAll();

		new Setting(containerEl)
			.setName(t("set_language_name"))
			.setDesc(t("set_language_desc"))
			.addDropdown((d) =>
				d
					.addOption("auto", t("lang_auto"))
					.addOption("en", t("lang_en"))
					.addOption("zh-TW", t("lang_zh"))
					.setValue(s.language)
					.onChange((v) => {
						s.language = v as LangSetting;
						setLang(s.language);
						save();
						this.display(); // 重繪讓設定頁即時換語言
					})
			);

		new Setting(containerEl)
			.setName(t("set_db_path_name"))
			.setDesc(t("set_db_path_desc", { path: DEFAULT_KOBO_DB_PATH }))
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_KOBO_DB_PATH)
					.setValue(s.koboDbPath)
					.onChange((v) => {
						s.koboDbPath = v;
						save();
					})
			);

		new Setting(containerEl)
			.setName(t("set_output_name"))
			.setDesc(t("set_output_desc"))
			.addText((text) =>
				text
					.setPlaceholder("PaperFolio")
					.setValue(s.outputFolder)
					.onChange((v) => {
						s.outputFolder = v.trim() || "PaperFolio";
						save();
					})
			);

		new Setting(containerEl)
			.setName(t("set_threshold_name"))
			.setDesc(t("set_threshold_desc"))
			.addText((text) =>
				text.setValue(String(s.minAnnotations)).onChange((v) => {
					const n = parseInt(v, 10);
					s.minAnnotations = Number.isFinite(n) && n >= 0 ? n : 0;
					save();
				})
			);

		new Setting(containerEl).setName(t("heading_format")).setHeading();

		new Setting(containerEl)
			.setName(t("set_style_name"))
			.addDropdown((d) =>
				d
					.addOption("callout", t("style_callout"))
					.addOption("blockquote", t("style_blockquote"))
					.addOption("bullet", t("style_bullet"))
					.setValue(s.highlightStyle)
					.onChange((v) => {
						s.highlightStyle = v as HighlightStyle;
						save();
					})
			);

		new Setting(containerEl)
			.setName(t("set_group_name"))
			.setDesc(t("set_group_desc"))
			.addToggle((tg) =>
				tg.setValue(s.groupByChapter).onChange((v) => {
					s.groupByChapter = v;
					save();
				})
			);

		new Setting(containerEl)
			.setName(t("set_date_name"))
			.addToggle((tg) =>
				tg.setValue(s.showDate).onChange((v) => {
					s.showDate = v;
					save();
				})
			);

		new Setting(containerEl)
			.setName(t("set_color_name"))
			.setDesc(t("set_color_desc"))
			.addToggle((tg) =>
				tg.setValue(s.colorAsTag).onChange((v) => {
					s.colorAsTag = v;
					save();
				})
			);

		new Setting(containerEl)
			.setName(t("set_filename_name"))
			.addDropdown((d) =>
				d
					.addOption("title", t("filename_title"))
					.addOption("title_author", t("filename_title_author"))
					.setValue(s.filenameFormat)
					.onChange((v) => {
						s.filenameFormat = v as FilenameFormat;
						save();
					})
			);

		new Setting(containerEl).setName(t("heading_dogear")).setHeading();

		new Setting(containerEl)
			.setName(t("set_dogear_name"))
			.setDesc(t("set_dogear_desc"))
			.addToggle((tg) =>
				tg.setValue(s.includeDogears).onChange((v) => {
					s.includeDogears = v;
					save();
				})
			);

		new Setting(containerEl)
			.setName(t("set_dogear_label_name"))
			.addText((text) =>
				text.setValue(s.dogearLabel).onChange((v) => {
					s.dogearLabel = v;
					save();
				})
			);

		// --- 無線接收(LAN) ---
		new Setting(containerEl).setName(t("heading_wireless")).setHeading();

		new Setting(containerEl)
			.setName(t("set_receiver_name"))
			.setDesc(t("set_receiver_desc"))
			.addToggle((tg) =>
				tg.setValue(s.receiverEnabled).onChange(async (v) => {
					s.receiverEnabled = v;
					if (v && !s.receiverToken) {
						s.receiverToken = this.plugin.newReceiverToken();
					}
					save();
					await this.plugin.restartReceiver();
					this.display(); // 重繪以更新同步位址/密鑰顯示
				})
			);

		new Setting(containerEl)
			.setName(t("set_port_name"))
			.setDesc(t("set_port_desc"))
			.addText((text) =>
				text.setValue(String(s.receiverPort)).onChange(async (v) => {
					const n = parseInt(v, 10);
					if (Number.isFinite(n) && n >= 1024 && n <= 65535) {
						s.receiverPort = n;
						save();
						await this.plugin.restartReceiver();
					}
				})
			);

		new Setting(containerEl)
			.setName(t("set_token_name"))
			.setDesc(t("set_token_desc"))
			.addText((text) => {
				text.setValue(s.receiverToken).setDisabled(true);
				text.inputEl.classList.add("paperfolio-token-input");
				return text;
			})
			.addExtraButton((b) =>
				b
					.setIcon("refresh-cw")
					.setTooltip(t("btn_regen_token"))
					.onClick(async () => {
						s.receiverToken = this.plugin.newReceiverToken();
						save();
						await this.plugin.restartReceiver();
						this.display();
					})
			);

		if (s.receiverEnabled) {
			const urls = this.plugin.lanSyncUrls();
			const info = new Setting(containerEl)
				.setName(t("set_syncurl_name"))
				.setDesc(t("set_syncurl_desc"));
			const box = info.descEl.createEl("div", {
				cls: "paperfolio-sync-urls",
			});
			if (urls.length === 0) {
				box.setText(t("syncurl_none"));
			} else {
				for (const u of urls) box.createEl("div", { text: u });
			}
		}
	}
}
