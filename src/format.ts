// 純排版層:把 Book 變成 Markdown 字串。零 Obsidian 依賴，可在 node 單獨跑(測試共用)。
// 移植自 Python obsidian.py 的渲染部分。檔案 I/O 在 writer.ts。
// 規則(道哥全域寫作規範):不用 emoji;書名用《》;列點間留空行。

import type { Book, Bookmark } from "./types";
import type { PaperFolioSettings } from "./settings";
import { t, bookTitle } from "./i18n";

export const PRODUCT = "PaperFolio";

export const SENTINEL_END = "<!-- KOBO:END -->";

// 開始哨兵:核心標記 KOBO:START 固定，後面說明文字隨語言。寫入時用當前語言。
function sentinelStart(): string {
	return `<!-- KOBO:START ${t("sentinel_note")} -->`;
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
	const parts: string[] = [sentinelStart(), ""];
	let currentChapter: string | undefined = undefined;
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
		parts.push(rendered);
		parts.push("");
	}
	parts.push(SENTINEL_END);
	return parts.join("\n");
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
