// PaperFolio for Kobo — 外掛進入點。
// Phase 1(USB):插上 Kobo → 點一下 → 解析 KoboReader.sqlite → 寫進 vault。

import * as fs from "fs";
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
import { runSync, summarize } from "./sync";

interface PluginData {
	settings: PaperFolioSettings;
	syncState: StateData;
}

export default class PaperFolioPlugin extends Plugin {
	settings: PaperFolioSettings = { ...DEFAULT_SETTINGS };
	syncState: StateData = {};
	private syncing = false;

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
	}

	private dbPath(): string {
		return this.settings.koboDbPath.trim() || DEFAULT_KOBO_DB_PATH;
	}

	async syncNow(): Promise<void> {
		if (this.syncing) {
			new Notice("PaperFolio：正在同步中，請稍候。");
			return;
		}
		this.syncing = true;
		try {
			const path = this.dbPath();
			if (!fs.existsSync(path)) {
				new Notice(
					`PaperFolio：找不到 Kobo 資料庫。\n請確認 Kobo 已插上並掛載，或在設定裡指定路徑。\n(${path})`,
					8000
				);
				return;
			}

			// -wal 沒被 checkpoint 時，主檔可能不含最新畫線;提醒但不阻擋。
			try {
				const wal = path + "-wal";
				if (fs.existsSync(wal) && fs.statSync(wal).size > 0) {
					console.warn(
						"PaperFolio：偵測到未 checkpoint 的 -wal，最新畫線可能尚未寫入主檔。建議在 Kobo 上安全退出後再同步。"
					);
				}
			} catch (e) {
				/* 忽略 wal 檢查失敗 */
			}

			new Notice("PaperFolio：開始解析 Kobo 畫線……");
			const bytes = new Uint8Array(fs.readFileSync(path));
			const books = await readBookmarks(bytes);

			const state = new State(this.syncState);
			const result = await runSync(this.app, books, this.settings, state);
			this.syncState = state.export();
			await this.saveAll();

			new Notice(`PaperFolio：${summarize(result)}`, 8000);
		} catch (err) {
			console.error("PaperFolio 同步失敗：", err);
			new Notice(
				`PaperFolio：同步失敗。\n${err instanceof Error ? err.message : String(err)}`,
				10000
			);
		} finally {
			this.syncing = false;
		}
	}

	private async loadAll(): Promise<void> {
		const data = (await this.loadData()) as Partial<PluginData> | null;
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			data?.settings ?? {}
		);
		this.syncState = data?.syncState ?? {};
	}

	async saveAll(): Promise<void> {
		const data: PluginData = {
			settings: this.settings,
			syncState: this.syncState,
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
	}
}
