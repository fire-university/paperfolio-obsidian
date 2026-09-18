// 純排版層:把 Book 變成 Markdown 字串。零 Obsidian 依賴，可在 node 單獨跑(測試共用)。
// 移植自 Python obsidian.py 的渲染部分。檔案 I/O 在 writer.ts。
// 規則(道哥全域寫作規範):不用 emoji;書名用《》;列點間留空行。

import type { Book, Bookmark } from "./types";
import type { PaperFolioSettings } from "./settings";
import { t, bookTitle } from "./i18n";

export const PRODUCT = "PaperFolio";

export const SENTINEL_END = "<!-- KOBO:END -->";

// 開始哨兵:核心標記 KOBO:START 固定，後面說明文字隨語言。寫入時用當前語言。
// 哨兵裡帶一個機器可讀的 items=N。
//
// **為什麼要寫進檔案而不是每次數一遍**:數渲染出來的內容會綁死樣式
// (callout 是 `> [!quote]`、bullet 是 `- `),換樣式就全錯,而且錯的方向是
// 「以為變少了」。把數量記在哨兵裡與樣式無關,而且打開筆記就看得懂。
// BLOCK_RE 中間是 [\s\S]*?,所以加這一段不會弄壞既有筆記的匹配。
function sentinelStart(items: number): string {
	return `<!-- KOBO:START items=${items} ${t("sentinel_note")} -->`;
}

// 從既有筆記的哨兵讀出上次寫入的條目數。舊筆記沒有 items= 就回 null
// (＝這次不擋,寫回去時順便補上)。
export function blockItemCount(text: string): number | null {
	const m = /<!--\s*KOBO:START[^\n]*?\bitems=(\d+)/.exec(text);
	return m ? Number(m[1]) : null;
}

// 這次要產出的比筆記裡現有的少 → 不要覆蓋。
//
// 十之八九是裝置那邊出事(重置、書庫同步到一半、書被移掉),不是使用者真的
// 刪了畫線;而整塊取代會把筆記截斷且完全不出聲。2026-09-18 一天內兩次。
// 回 null 表示安全可寫;回 {from,to} 表示要擋,數字給摘要點名用。
//
// 舊筆記(沒有 items=)一律放行,寫回去時順便把 items= 補上——升級後第一次
// 同步不會突然整批被擋住。
export function shrinkGuard(
	existing: string,
	block: string
): { from: number; to: number } | null {
	const from = blockItemCount(existing);
	const to = blockItemCount(block);
	if (from === null || to === null) return null;
	return to < from ? { from, to } : null;
}



// 索引檔名隨語言(道哥保持繁中則不變)。
export function indexFilename(): string {
	return t("index_filename");
}

// 語言無關:只認核心標記 KOBO:START…KOBO:END，這樣不同語言/舊筆記的說明文字都對得到，
// 翻譯說明也不會弄壞既有筆記的增量比對。
export const BLOCK_RE = /<!--\s*KOBO:START[\s\S]*?KOBO:END\s*-->/;
const INVALID_FS = /[\\/:*?"<>|]/g;

export function today(): string {
	const d = new Date();
	const p = (n: number) => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function shortDate(raw: string): string {
	return (raw || "").slice(0, 10);
}

export function sanitizeFilename(name: string): string {
	// 特殊字元換成全形空格，避免破壞檔名;去頭尾空白與句點;長度上限 120。
	const cleaned = name.replace(INVALID_FS, "　").trim().replace(/\.+$/, "");
	return (cleaned || t("untitled_book")).slice(0, 120);
}

export function bookFilename(book: Book, filenameFormat: string): string {
	const base =
		filenameFormat === "title_author" && book.author
			? `${book.title} - ${book.author}`
			: book.title;
	return sanitizeFilename(base) + ".md";
}

// ---------- 單條渲染 ----------

function renderHighlight(b: Bookmark, s: PaperFolioSettings): string {
	const date = s.showDate ? shortDate(b.dateCreated) : "";
	const tag = s.colorAsTag && b.color !== null ? `#kobo/color-${b.color}` : "";
	const text = b.text.trim();
	const ann = b.annotation ? b.annotation.replace(/\n/g, " ").trim() : "";

	if (s.highlightStyle === "callout") {
		const head = `> [!quote]${date ? " " + date : ""}`;
		const body = text
			.split("\n")
			.map((ln) => `> ${ln}`)
			.join("\n");
		let out = head + "\n" + body;
		if (tag) out += `\n> ${tag}`;
		if (ann) out += `\n>\n> ${t("annotation_prefix")}${ann}`;
		return out;
	}

	if (s.highlightStyle === "bullet") {
		const suffix = date ? `（${date}）` : "";
		let line = `- ${text}${suffix}`;
		if (tag) line += ` ${tag}`;
		if (ann) line += `\n  - ${t("annotation_prefix")}${ann}`;
		return line;
	}

	// blockquote(傳統)
	const lines = text.split("\n").map((ln) => `> ${ln}`);
	if (tag) lines.push(`> ${tag}`);
	if (ann) lines.push("", `　　${t("annotation_prefix")}${ann}`);
	if (date) lines.push("", `　　— ${date}`);
	return lines.join("\n");
}

function renderDogear(b: Bookmark, s: PaperFolioSettings): string {
	// Phase 1:只記位置(無 epub 文字還原)。
	const pct = Math.round(b.chapterProgress * 100);
	const ch = b.chapterTitle || t("chapter_unknown");
	return t("dogear_position_only", { label: s.dogearLabel, chapter: ch, pct });
}

function renderItem(b: Bookmark, s: PaperFolioSettings): string | null {
	if (b.type === "dogear") {
		if (!s.includeDogears) return null;
		return renderDogear(b, s);
	}
	if (!b.text && !b.annotation) return null;
	return renderHighlight(b, s);
}

export function buildKoboBlock(book: Book, s: PaperFolioSettings): string {
	const parts: string[] = [];
	let currentChapter: string | undefined = undefined;
	let items = 0;
	for (const b of book.bookmarks) {
		if (s.groupByChapter) {
			const ch = b.chapterTitle || "";
			if (ch !== currentChapter) {
				currentChapter = ch;
				if (ch) {
					// 對不到真章節名就不印醜標題
					parts.push(`## ${ch}`);
					parts.push("");
				}
			}
		}
		const rendered = renderItem(b, s);
		if (rendered === null) continue;
		items++;
		parts.push(rendered);
		parts.push("");
	}
	parts.push(SENTINEL_END);
	// 條目數 = 實際被 renderItem 產出的那些(略過的不算),所以在最後才組哨兵。
	return [sentinelStart(items), "", ...parts].join("\n");
}

// 給即時預覽用:只回傳 KOBO 區塊，不含 frontmatter。
export function renderBookBody(book: Book, s: PaperFolioSettings): string {
	return buildKoboBlock(book, s);
}

// ---------- 整檔組裝 ----------

export function newFileContent(book: Book, block: string): string {
	const today_ = today();
	return [
		"---",
		`title: ${bookTitle(book.title)}`,
		`author: ${book.author}`,
		"source: kobo",
		`generated_by: ${PRODUCT.toLowerCase()}`,
		`isbn: ${book.isbn}`,
		"tags: [kobo, reading]",
		`created: ${today_}`,
		`last_synced: ${today_}`,
		"---",
		"",
		`# ${bookTitle(book.title)}`,
		"",
		t("note_summary_prompt"),
		"",
		block,
		"",
	].join("\n");
}

export function mergeIntoExisting(existing: string, block: string): string {
	const today_ = today();
	let merged: string;
	if (BLOCK_RE.test(existing)) {
		// 用函式回傳避免 block 內的 $ 被當成 replace 特殊符號
		merged = existing.replace(BLOCK_RE, () => block);
	} else {
		merged = existing.replace(/\s+$/, "") + "\n\n" + block + "\n";
	}
	// 只更新第一個 last_synced，其他 frontmatter 不動
	merged = merged.replace(/^(last_synced:).*$/m, `$1 ${today_}`);
	return merged;
}

// ---------- 索引 MOC ----------

export type IndexRow = [
	title: string,
	highlights: number,
	dogears: number,
	filename: string,
];

export function buildIndexContent(
	rows: IndexRow[],
	settings: PaperFolioSettings
): string {
	const sorted = [...rows].sort((a, b) => b[1] - a[1] || b[2] - a[2]);
	const totalH = sorted.reduce((sum, r) => sum + r[1], 0);
	const totalD = sorted.reduce((sum, r) => sum + r[2], 0);

	const include = settings.includeDogears;
	const summary = include
		? t("index_summary_dogears", {
				books: sorted.length,
				h: totalH,
				d: totalD,
				product: PRODUCT,
		  })
		: t("index_summary_plain", {
				books: sorted.length,
				h: totalH,
				product: PRODUCT,
		  });

	const colBook = t("index_col_book");
	const colH = t("index_col_highlights");
	const colD = t("index_col_dogears");
	const table = include
		? [`| ${colBook} | ${colH} | ${colD} |`, "| :-- | --: | --: |"]
		: [`| ${colBook} | ${colH} |`, "| :-- | --: |"];

	for (const [title, h, d, fname] of sorted) {
		const stem = fname.endsWith(".md") ? fname.slice(0, -3) : fname;
		table.push(
			include
				? `| [[${stem}\\|${bookTitle(title)}]] | ${h} | ${d} |`
				: `| [[${stem}\\|${bookTitle(title)}]] | ${h} |`
		);
	}

	return [
		"---",
		`generated_by: ${PRODUCT.toLowerCase()}`,
		"tags: [kobo, index, MOC]",
		`last_synced: ${today()}`,
		"---",
		"",
		`# ${t("index_heading")}`,
		"",
		summary,
		"",
		...table,
		"",
	].join("\n");
}

// ---------- 同步摘要 ----------
// 放這裡而不是 sync.ts:這支是純字串組裝,而 sync.ts import 了 obsidian,
// 放那邊 node 就測不到它(照本檔開頭那條「零 Obsidian 依賴」的分工)。

export interface SyncResult {
	books: number;
	highlights: number;
	dogears: number;
	newItems: number;
	filesWritten: number;
	skippedBooks: number;
	words?: number; // 這次新增的生詞數(單字同步關著時為 undefined)
	sources?: string[]; // 這次實際讀到的來源,由 main 填
	shrunk: string[]; // 因為畫線變少而跳過的書(「書名 274→20」)
}

export function summarize(r: SyncResult): string {
	const extra = r.skippedBooks
		? t("summary_extra", { n: r.skippedBooks })
		: "";
	const words = r.words ? t("summary_words", { n: r.words }) : "";
	// 來源一定要寫出來(見 i18n 的 summary_sources 註解)。
	const src = r.sources?.length
		? t("summary_sources", { list: r.sources.join(" + ") })
		: "";
	// 被擋下來的一定要點名。只講「跳過 3 本」等於沒講——要能一眼分辨
	// 「機器剛重置」還是「這本我真的刪過畫線」。
	const shrunk = r.shrunk?.length
		? t("summary_shrunk", { n: r.shrunk.length, list: r.shrunk.join("、") })
		: "";
	return (
		t("summary", {
			h: r.highlights,
			d: r.dogears,
			books: r.books,
			extra,
		}) + words + src + shrunk
	);
}
