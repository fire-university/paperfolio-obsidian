// 外掛設定:對應 SPEC §12。Phase 1(USB)只用到排版/門檻/路徑相關;
// 無線接收埠等留給 Phase 2。

import type { LangSetting } from "./i18n";

export type HighlightStyle = "callout" | "blockquote" | "bullet";
export type FilenameFormat = "title" | "title_author";

export interface PaperFolioSettings {
	// 介面與筆記語言:auto 跟 Obsidian、en、zh-TW
	language: LangSetting;

	// Kobo 的 KoboReader.sqlite 路徑;留空 = 自動用預設掛載路徑。
	koboDbPath: string;
	// Kobo Desktop(電腦版)的本機資料庫路徑;留空 = 自動偵測。設 "off" 可停用此來源。
	koboDesktopDbPath: string;
	// 輸出資料夾(vault 相對路徑);工具永遠只碰這裡。
	outputFolder: string;
	// 門檻:一本書畫線＋(折頁若含)合計低於此數就不匯入。
	minAnnotations: number;

	// --- 排版 ---
	highlightStyle: HighlightStyle;
	groupByChapter: boolean;
	showDate: boolean;
	colorAsTag: boolean;
	includeDogears: boolean; // 預設 false(道哥只要畫線;且無 epub 還原)
	dogearLabel: string;
	filenameFormat: FilenameFormat;

	// --- 無線接收(LAN) ---
	receiverEnabled: boolean; // Obsidian 開著時聽一個埠，Kobo 一鍵推 DB
	receiverPort: number;
	receiverToken: string; // 共享密鑰(Kobo 帶同一組;首次啟用自動產生)
}

// 預設掛載路徑(macOS)。Kobo 插上後通常掛在這。
export const DEFAULT_KOBO_DB_PATH =
	"/Volumes/KOBOeReader/.kobo/KoboReader.sqlite";

// Kobo Desktop(電腦版)資料目錄與資料庫(macOS 預設);書檔在同層 kepub/。
export const DEFAULT_KOBO_DESKTOP_DIR =
	"Library/Application Support/Kobo/Kobo Desktop Edition";
export const KOBO_DESKTOP_DB_NAME = "Kobo.sqlite";

export const DEFAULT_SETTINGS: PaperFolioSettings = {
	language: "auto",
	koboDbPath: "",
	koboDesktopDbPath: "",
	outputFolder: "PaperFolio",
	minAnnotations: 3,
	highlightStyle: "callout",
	groupByChapter: true,
	showDate: true,
	colorAsTag: false,
	includeDogears: false,
	dogearLabel: "【折頁】",
	filenameFormat: "title",
	receiverEnabled: false,
	receiverPort: 8321,
	receiverToken: "",
};
