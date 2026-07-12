// 純排版層:把 Book 變成 Markdown 字串。零 Obsidian 依賴，可在 node 單獨跑(測試共用)。
// 移植自 Python obsidian.py 的渲染部分。檔案 I/O 在 writer.ts。
// 規則(道哥全域寫作規範):不用 emoji;書名用《》;列點間留空行。

import type { Book, Bookmark } from "./types";
import type { PaperFolioSettings } from "./settings";

export const PRODUCT = "PaperFolio";

export const SENTINEL_START = "<!-- KOBO:START 自動維護，勿手改此區塊內文字 -->";
export const SENTINEL_END = "<!-- KOBO:END -->";
export const INDEX_NAME = "00_Kobo 畫線索引.md";

function escapeRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export const BLOCK_RE = new RegExp(
	escapeRegex(SENTINEL_START) + "[\\s\\S]*?" + escapeRegex(SENTINEL_END)
);
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
	return (cleaned || "未命名書籍").slice(0, 120);
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
		if (ann) out += `\n>\n> 附註：${ann}`;
		return out;
	}

	if (s.highlightStyle === "bullet") {
		const suffix = date ? `（${date}）` : "";
		let line = `- ${text}${suffix}`;
		if (tag) line += ` ${tag}`;
		if (ann) line += `\n  - 附註：${ann}`;
		return line;
	}

	// blockquote(傳統)
	const lines = text.split("\n").map((ln) => `> ${ln}`);
	if (tag) lines.push(`> ${tag}`);
	if (ann) lines.push("", `　　附註：${ann}`);
	if (date) lines.push("", `　　— ${date}`);
	return lines.join("\n");
}

function renderDogear(b: Bookmark, s: PaperFolioSettings): string {
	// Phase 1:只記位置(無 epub 文字還原)。
	const pct = Math.round(b.chapterProgress * 100);
	const ch = b.chapterTitle || "（未知章節）";
	return `${s.dogearLabel}${ch}，約 ${pct}% 處（僅記位置）`;
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
	const parts: string[] = [SENTINEL_START, ""];
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
	const t = today();
	return [
		"---",
		`title: 《${book.title}》`,
		`author: ${book.author}`,
		"source: kobo",
		`generated_by: ${PRODUCT.toLowerCase()}`,
		`isbn: ${book.isbn}`,
		"tags: [kobo, reading]",
		`created: ${t}`,
		`last_synced: ${t}`,
		"---",
		"",
		`# 《${book.title}》`,
		"",
		"（此行以上留給你手寫總結／心得，工具不會碰）",
		"",
		block,
		"",
	].join("\n");
}

export function mergeIntoExisting(existing: string, block: string): string {
	const t = today();
	let merged: string;
	if (BLOCK_RE.test(existing)) {
		// 用函式回傳避免 block 內的 $ 被當成 replace 特殊符號
		merged = existing.replace(BLOCK_RE, () => block);
	} else {
		merged = existing.replace(/\s+$/, "") + "\n\n" + block + "\n";
	}
	// 只更新第一個 last_synced，其他 frontmatter 不動
	merged = merged.replace(/^(last_synced:).*$/m, `$1 ${t}`);
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
		? `共 ${sorted.length} 本書、${totalH} 條畫線、${totalD} 個折頁。此檔與本資料夾所有筆記皆由 ${PRODUCT} 自動產生。`
		: `共 ${sorted.length} 本書、${totalH} 條畫線。此檔與本資料夾所有筆記皆由 ${PRODUCT} 自動產生。`;

	const table = include
		? ["| 書 | 畫線 | 折頁 |", "| :-- | --: | --: |"]
		: ["| 書 | 畫線 |", "| :-- | --: |"];

	for (const [title, h, d, fname] of sorted) {
		const stem = fname.endsWith(".md") ? fname.slice(0, -3) : fname;
		table.push(
			include
				? `| [[${stem}\\|《${title}》]] | ${h} | ${d} |`
				: `| [[${stem}\\|《${title}》]] | ${h} |`
		);
	}

	return [
		"---",
		`generated_by: ${PRODUCT.toLowerCase()}`,
		"tags: [kobo, index, MOC]",
		`last_synced: ${today()}`,
		"---",
		"",
		"# Kobo 畫線索引",
		"",
		summary,
		"",
		...table,
		"",
	].join("\n");
}
