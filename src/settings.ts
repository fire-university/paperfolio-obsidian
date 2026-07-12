// 外掛設定:對應 SPEC §12。Phase 1(USB)只用到排版/門檻/路徑相關;
// 無線接收埠等留給 Phase 2。

export type HighlightStyle = "callout" | "blockquote" | "bullet";
export type FilenameFormat = "title" | "title_author";

export interface PaperFolioSettings {
	// Kobo 的 KoboReader.sqlite 路徑;留空 = 自動用預設掛載路徑。
	koboDbPath: string;
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
}

// 預設掛載路徑(macOS)。Kobo 插上後通常掛在這。
export const DEFAULT_KOBO_DB_PATH =
	"/Volumes/KOBOeReader/.kobo/KoboReader.sqlite";

export const DEFAULT_SETTINGS: PaperFolioSettings = {
	koboDbPath: "",
	outputFolder: "PaperFolio",
	minAnnotations: 3,
	highlightStyle: "callout",
	groupByChapter: true,
	showDate: true,
	colorAsTag: false,
	includeDogears: false,
	dogearLabel: "【折頁】",
	filenameFormat: "title",
};
