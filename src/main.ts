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

		this.addRibbonIcon("book-open", "PaperFolio：同步 Kobo 畫線", () => {
			void this.syncNow();
		});

		this.addCommand({
			id: "sync-kobo-highlights",
			name: "同步 Kobo 畫線到 Obsidian",
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
		if (this.syncing) throw new Error("同步進行中，請稍候");
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
				new Notice(
					`PaperFolio：找不到 Kobo 資料庫。\n請確認 Kobo 已插上並掛載，或在設定裡指定路徑。\n(${dbPath})`,
					8000
				);
				return;
			}

			// -wal 沒被 checkpoint 時，主檔可能不含最新畫線;提醒但不阻擋。
			try {
				const wal = dbPath + "-wal";
				if (fs.existsSync(wal) && fs.statSync(wal).size > 0) {
					console.warn(
						"PaperFolio：偵測到未 checkpoint 的 -wal，最新畫線可能尚未寫入主檔。建議在 Kobo 上安全退出後再同步。"
					);
				}
			} catch (e) {
				/* 忽略 wal 檢查失敗 */
			}

			new Notice("PaperFolio：開始解析 Kobo 畫線……");
			const bytes = new Uint8Array(fs.readFileSync(dbPath));
			const result = await this.syncFromBytes(bytes, this.volumeRoot());
			new Notice(`PaperFolio：${summarize(result)}`, 8000);
		} catch (err) {
			console.error("PaperFolio 同步失敗：", err);
			new Notice(
				`PaperFolio：同步失敗。\n${err instanceof Error ? err.message : String(err)}`,
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
				new Notice(`PaperFolio（無線）：${msg}`, 8000);
				return msg;
			},
			onError: (err) => {
				console.error("PaperFolio 接收端錯誤：", err);
				new Notice(`PaperFolio：接收端錯誤 ${err.message}`, 8000);
			},
		});
		try {
			await rx.start();
			this.receiver = rx;
			new Notice(
				`PaperFolio：無線接收端已啟動（埠 ${this.settings.receiverPort}）`
			);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			new Notice(
				`PaperFolio：接收端啟動失敗（${msg}）。\n可能是埠被占用，換個埠再試。`,
				10000
			);
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
			.setName("Kobo 資料庫路徑")
			.setDesc(
				`留空就用預設掛載路徑。預設：${DEFAULT_KOBO_DB_PATH}`
			)
			.addText((t) =>
				t
					.setPlaceholder(DEFAULT_KOBO_DB_PATH)
					.setValue(s.koboDbPath)
					.onChange((v) => {
						s.koboDbPath = v;
						save();
					})
			);

		new Setting(containerEl)
			.setName("輸出資料夾")
			.setDesc("筆記寫到 vault 的這個資料夾;工具永遠只碰這裡。")
			.addText((t) =>
				t
					.setPlaceholder("PaperFolio")
					.setValue(s.outputFolder)
					.onChange((v) => {
						s.outputFolder = v.trim() || "PaperFolio";
						save();
					})
			);

		new Setting(containerEl)
			.setName("匯入門檻")
			.setDesc("一本書的畫線數(含折頁若開啟)低於此數就不匯入，過濾零星雜訊。")
			.addText((t) =>
				t.setValue(String(s.minAnnotations)).onChange((v) => {
					const n = parseInt(v, 10);
					s.minAnnotations = Number.isFinite(n) && n >= 0 ? n : 0;
					save();
				})
			);

		new Setting(containerEl).setName("排版").setHeading();

		new Setting(containerEl)
			.setName("畫線呈現風格")
			.addDropdown((d) =>
				d
					.addOption("callout", "Callout(建議)")
					.addOption("blockquote", "引用區塊")
					.addOption("bullet", "條列")
					.setValue(s.highlightStyle)
					.onChange((v) => {
						s.highlightStyle = v as HighlightStyle;
						save();
					})
			);

		new Setting(containerEl)
			.setName("依章節分組")
			.setDesc("用真章節名(來自 Kobo 目錄)當小標題。")
			.addToggle((t) =>
				t.setValue(s.groupByChapter).onChange((v) => {
					s.groupByChapter = v;
					save();
				})
			);

		new Setting(containerEl)
			.setName("顯示日期")
			.addToggle((t) =>
				t.setValue(s.showDate).onChange((v) => {
					s.showDate = v;
					save();
				})
			);

		new Setting(containerEl)
			.setName("顏色轉標籤")
			.setDesc("把 Kobo 畫線顏色加成 #kobo/color-N 標籤。")
			.addToggle((t) =>
				t.setValue(s.colorAsTag).onChange((v) => {
					s.colorAsTag = v;
					save();
				})
			);

		new Setting(containerEl)
			.setName("檔名格式")
			.addDropdown((d) =>
				d
					.addOption("title", "《書名》")
					.addOption("title_author", "書名 - 作者")
					.setValue(s.filenameFormat)
					.onChange((v) => {
						s.filenameFormat = v as FilenameFormat;
						save();
					})
			);

		new Setting(containerEl).setName("折頁").setHeading();

		new Setting(containerEl)
			.setName("匯入折頁")
			.setDesc(
				"折頁只記位置(章節＋進度%)，沒有文字。多數人只要畫線，預設關閉。"
			)
			.addToggle((t) =>
				t.setValue(s.includeDogears).onChange((v) => {
					s.includeDogears = v;
					save();
				})
			);

		new Setting(containerEl)
			.setName("折頁標籤文字")
			.addText((t) =>
				t.setValue(s.dogearLabel).onChange((v) => {
					s.dogearLabel = v;
					save();
				})
			);

		// --- 無線接收(LAN) ---
		new Setting(containerEl).setName("無線接收（區網）").setHeading();

		new Setting(containerEl)
			.setName("啟用無線接收")
			.setDesc(
				"Obsidian 開著時聽一個埠，讓同一個 WiFi 的 Kobo 一鍵把畫線推過來。綁 0.0.0.0，靠下方密鑰保護;首次啟用 macOS 可能問「允許接受連線」，請點允許。"
			)
			.addToggle((t) =>
				t.setValue(s.receiverEnabled).onChange(async (v) => {
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
			.setName("接收埠")
			.setDesc("預設 8321。改了會重啟接收端。")
			.addText((t) =>
				t.setValue(String(s.receiverPort)).onChange(async (v) => {
					const n = parseInt(v, 10);
					if (Number.isFinite(n) && n >= 1024 && n <= 65535) {
						s.receiverPort = n;
						save();
						await this.plugin.restartReceiver();
					}
				})
			);

		new Setting(containerEl)
			.setName("接收密鑰")
			.setDesc("Kobo 端要帶同一組（header X-PaperFolio-Token）。")
			.addText((t) => {
				t.setValue(s.receiverToken).setDisabled(true);
				t.inputEl.style.width = "22em";
				return t;
			})
			.addExtraButton((b) =>
				b
					.setIcon("refresh-cw")
					.setTooltip("重新產生密鑰")
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
				.setName("你的同步位址")
				.setDesc(
					"在 Kobo 的推送腳本填入這個位址與上方密鑰（同一個 WiFi 才連得到）。"
				);
			const box = info.descEl.createEl("div");
			box.style.marginTop = "0.5em";
			box.style.fontFamily = "var(--font-monospace)";
			box.style.userSelect = "text";
			if (urls.length === 0) {
				box.setText("（找不到區網 IP，請確認 Mac 已連上 WiFi）");
			} else {
				for (const u of urls) box.createEl("div", { text: u });
			}
		}
	}
}
