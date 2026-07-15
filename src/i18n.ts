// 輕量 i18n:一個 t(key) + en / zh-TW 兩份字典。無官方框架，自建。
// 語言由設定決定:auto = 跟 Obsidian 顯示語言走;否則用指定語言。預設 fallback 英文。
// 純模組(node 測試時 window 不存在 → 走 try/catch 回 en)。

export type LangSetting = "auto" | "en" | "zh-TW";
type Lang = "en" | "zh-TW";

let current: Lang = "en";

export function resolveLang(setting: LangSetting): Lang {
	if (setting === "en" || setting === "zh-TW") return setting;
	// auto:讀 Obsidian 存在 localStorage 的顯示語言碼(zh-TW / zh / null 等)
	let code = "";
	try {
		code = (window.localStorage.getItem("language") || "").toLowerCase();
	} catch (e) {
		/* node 測試環境無 window */
	}
	return code.startsWith("zh") ? "zh-TW" : "en";
}

export function setLang(setting: LangSetting): void {
	current = resolveLang(setting);
}

export function currentLang(): Lang {
	return current;
}

function interpolate(s: string, params?: Record<string, string | number>): string {
	if (!params) return s;
	let out = s;
	for (const k of Object.keys(params)) {
		out = out.replace(new RegExp("\\{" + k + "\\}", "g"), String(params[k]));
	}
	return out;
}

export function t(key: string, params?: Record<string, string | number>): string {
	const dict = STRINGS[current] || STRINGS.en;
	const s = dict[key] ?? STRINGS.en[key] ?? key;
	return interpolate(s, params);
}

// 書名顯示:中文加《》，英文原樣。
export function bookTitle(title: string): string {
	return current === "zh-TW" ? `《${title}》` : title;
}

type Dict = Record<string, string>;

const EN: Dict = {
	// 命令 / 圖示
	ribbon_tooltip: "PaperFolio: sync Kobo highlights",
	command_sync: "Sync Kobo highlights to Obsidian",

	// 通知
	notice_parsing: "PaperFolio: parsing Kobo highlights…",
	notice_db_not_found:
		"PaperFolio: Kobo database not found.\nMake sure your Kobo is plugged in and mounted, or set the path in settings.\n({path})",
	notice_sync_failed: "PaperFolio: sync failed.\n{err}",
	notice_result: "PaperFolio: {msg}",
	notice_wireless_result: "PaperFolio (wireless): {msg}",
	notice_receiver_started: "PaperFolio: wireless receiver started (port {port})",
	notice_receiver_start_failed:
		"PaperFolio: failed to start receiver ({err}).\nThe port may be in use; try another port.",
	notice_receiver_error: "PaperFolio: receiver error {err}",

	// 設定 — 一般
	set_db_path_name: "Kobo database path",
	set_db_path_desc: "Leave empty to use the default mount path. Default: {path}",
	set_output_name: "Output folder",
	set_output_desc:
		"Notes are written to this folder in your vault; the plugin only ever touches this folder.",
	set_threshold_name: "Import threshold",
	set_threshold_desc:
		"Books with fewer highlights than this (including dogears, if enabled) are skipped, to filter out noise.",

	// 設定 — 排版
	heading_format: "Formatting",
	set_style_name: "Highlight style",
	style_callout: "Callout (recommended)",
	style_blockquote: "Blockquote",
	style_bullet: "Bullet list",
	set_group_name: "Group by chapter",
	set_group_desc:
		"Use real chapter names (from the Kobo table of contents) as subheadings.",
	set_date_name: "Show date",
	set_color_name: "Color as tag",
	set_color_desc: "Add the Kobo highlight color as a #kobo/color-N tag.",
	set_filename_name: "Filename format",
	filename_title: "Title",
	filename_title_author: "Title - Author",

	// 設定 — 折頁
	heading_dogear: "Dogears",
	set_dogear_name: "Import dogears",
	set_dogear_desc:
		"Dogears record only position (chapter + progress %), no text. Most people only want highlights, so this is off by default.",
	set_dogear_label_name: "Dogear label",

	// 設定 — 無線
	heading_wireless: "Wireless receiver (LAN)",
	set_receiver_name: "Enable wireless receiver",
	set_receiver_desc:
		"While Obsidian is open, listen on a port so a Kobo on the same Wi-Fi can push highlights with one tap. It binds 0.0.0.0 and is protected by the key below; on first enable macOS may ask to allow incoming connections — click Allow.",
	set_port_name: "Receiver port",
	set_port_desc: "Default 8321. Changing this restarts the receiver.",
	set_token_name: "Receiver key",
	set_token_desc:
		"The Kobo side must send the same key (header X-PaperFolio-Token).",
	btn_regen_token: "Regenerate key",
	set_syncurl_name: "Your sync address",
	set_syncurl_desc:
		"Put this address and the key above into the Kobo push script (same Wi-Fi only).",
	syncurl_none: "(No LAN IP found; make sure your Mac is connected to Wi-Fi.)",

	// 設定 — 語言
	set_language_name: "Language",
	set_language_desc: "Language for the interface and generated notes.",
	lang_auto: "Auto (follow Obsidian)",
	lang_en: "English",
	lang_zh: "繁體中文",

	// 筆記內容
	note_summary_prompt:
		"(Write your own summary above this line; the plugin won't touch it.)",
	annotation_prefix: "Note: ",
	chapter_unknown: "(Unknown chapter)",
	dogear_position_only: "{label}{chapter}, ~{pct}% (position only)",
	sentinel_note: "Auto-maintained; do not edit text inside this block.",
	untitled_book: "Untitled book",

	// 索引
	index_filename: "00_Kobo Highlights Index.md",
	index_heading: "Kobo Highlights Index",
	index_summary_dogears:
		"{books} books, {h} highlights, {d} dogears. This file and every note in this folder are generated automatically by {product}.",
	index_summary_plain:
		"{books} books, {h} highlights. This file and every note in this folder are generated automatically by {product}.",
	index_col_book: "Book",
	index_col_highlights: "Highlights",
	index_col_dogears: "Dogears",

	// 摘要
	summary: "Imported {h} highlights, {d} dogears ({books} books{extra})",
	summary_extra: ", skipped {n} sparse books",

	err_sync_in_progress: "Sync already in progress, please wait.",
};

const ZH: Dict = {
	ribbon_tooltip: "PaperFolio：同步 Kobo 畫線",
	command_sync: "同步 Kobo 畫線到 Obsidian",

	notice_parsing: "PaperFolio：開始解析 Kobo 畫線……",
	notice_db_not_found:
		"PaperFolio：找不到 Kobo 資料庫。\n請確認 Kobo 已插上並掛載，或在設定裡指定路徑。\n({path})",
	notice_sync_failed: "PaperFolio：同步失敗。\n{err}",
	notice_result: "PaperFolio：{msg}",
	notice_wireless_result: "PaperFolio（無線）：{msg}",
	notice_receiver_started: "PaperFolio：無線接收端已啟動（埠 {port}）",
	notice_receiver_start_failed:
		"PaperFolio：接收端啟動失敗（{err}）。\n可能是埠被占用，換個埠再試。",
	notice_receiver_error: "PaperFolio：接收端錯誤 {err}",

	set_db_path_name: "Kobo 資料庫路徑",
	set_db_path_desc: "留空就用預設掛載路徑。預設：{path}",
	set_output_name: "輸出資料夾",
	set_output_desc: "筆記寫到 vault 的這個資料夾；工具永遠只碰這裡。",
	set_threshold_name: "匯入門檻",
	set_threshold_desc:
		"一本書的畫線數（含折頁若開啟）低於此數就不匯入，過濾零星雜訊。",

	heading_format: "排版",
	set_style_name: "畫線呈現風格",
	style_callout: "Callout（建議）",
	style_blockquote: "引用區塊",
	style_bullet: "條列",
	set_group_name: "依章節分組",
	set_group_desc: "用真章節名（來自 Kobo 目錄）當小標題。",
	set_date_name: "顯示日期",
	set_color_name: "顏色轉標籤",
	set_color_desc: "把 Kobo 畫線顏色加成 #kobo/color-N 標籤。",
	set_filename_name: "檔名格式",
	filename_title: "《書名》",
	filename_title_author: "書名 - 作者",

	heading_dogear: "折頁",
	set_dogear_name: "匯入折頁",
	set_dogear_desc:
		"折頁只記位置（章節＋進度%），沒有文字。多數人只要畫線，預設關閉。",
	set_dogear_label_name: "折頁標籤文字",

	heading_wireless: "無線接收（區網）",
	set_receiver_name: "啟用無線接收",
	set_receiver_desc:
		"Obsidian 開著時聽一個埠，讓同一個 WiFi 的 Kobo 一鍵把畫線推過來。綁 0.0.0.0，靠下方密鑰保護；首次啟用 macOS 可能問「允許接受連線」，請點允許。",
	set_port_name: "接收埠",
	set_port_desc: "預設 8321。改了會重啟接收端。",
	set_token_name: "接收密鑰",
	set_token_desc: "Kobo 端要帶同一組（header X-PaperFolio-Token）。",
	btn_regen_token: "重新產生密鑰",
	set_syncurl_name: "你的同步位址",
	set_syncurl_desc:
		"在 Kobo 的推送腳本填入這個位址與上方密鑰（同一個 WiFi 才連得到）。",
	syncurl_none: "（找不到區網 IP，請確認 Mac 已連上 WiFi）",

	set_language_name: "語言",
	set_language_desc: "介面與產出筆記的語言。",
	lang_auto: "自動（跟 Obsidian）",
	lang_en: "English",
	lang_zh: "繁體中文",

	note_summary_prompt: "（此行以上留給你手寫總結／心得，工具不會碰）",
	annotation_prefix: "附註：",
	chapter_unknown: "（未知章節）",
	dogear_position_only: "{label}{chapter}，約 {pct}% 處（僅記位置）",
	sentinel_note: "自動維護，勿手改此區塊內文字",
	untitled_book: "未命名書籍",

	index_filename: "00_Kobo 畫線索引.md",
	index_heading: "Kobo 畫線索引",
	index_summary_dogears:
		"共 {books} 本書、{h} 條畫線、{d} 個折頁。此檔與本資料夾所有筆記皆由 {product} 自動產生。",
	index_summary_plain:
		"共 {books} 本書、{h} 條畫線。此檔與本資料夾所有筆記皆由 {product} 自動產生。",
	index_col_book: "書",
	index_col_highlights: "畫線",
	index_col_dogears: "折頁",

	summary: "已匯入 {h} 條畫線、{d} 個折頁（{books} 本書{extra}）",
	summary_extra: "，略過 {n} 本零星書",

	err_sync_in_progress: "同步進行中，請稍候。",
};

const STRINGS: Record<Lang, Dict> = { en: EN, "zh-TW": ZH };
