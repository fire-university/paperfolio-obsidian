// 輸出層:一本書一則 .md，KOBO 哨兵區塊增量更新，保護手寫心得。
// 移植自 Python obsidian.py，改用 Obsidian Vault API 寫檔。
// 規則(道哥全域寫作規範):不用 emoji;書名用《》;列點間留空行。
// 只重寫 <!-- KOBO:START --> 與 <!-- KOBO:END --> 之間，區塊外永不動。
// 註:Phase 1 折頁只記位置(章節＋進度%)，epub 文字還原留給後續階段。

import { App, normalizePath } from "obsidian";
import type { Book, Bookmark } from "./types";
import type { PaperFolioSettings } from "./settings";
import type { State } from "./state";

export const PRODUCT = "PaperFolio";

const SENTINEL_START = "<!-- KOBO:START 自動維護，勿手改此區塊內文字 -->";
const SENTINEL_END = "<!-- KOBO:END -->";
const INDEX_NAME = "00_Kobo 畫線索引.md";

function escapeRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const BLOCK_RE = new RegExp(
	escapeRegex(SENTINEL_START) + "[\\s\\S]*?" + escapeRegex(SENTINEL_END)
);
const INVALID_FS = /[\\/:*?"<>|]/g;

export interface BookStats {
	filename: string;
	written: boolean;
	new: number;
	highlights: number;
	dogears: number;
}

function today(): string {
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
	const tag =
		s.colorAsTag && b.color !== null ? `#kobo/color-${b.color}` : "";
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

function buildKoboBlock(book: Book, s: PaperFolioSettings): string {
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

// ---------- 檔案組裝 ----------

function newFileContent(book: Book, block: string): string {
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

function mergeIntoExisting(existing: string, block: string): string {
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

// ---------- Vault 寫入 ----------

async function ensureFolder(app: App, folder: string): Promise<void> {
	const parts = normalizePath(folder).split("/").filter(Boolean);
	let cur = "";
	for (const p of parts) {
		cur = cur ? `${cur}/${p}` : p;
		if (!(await app.vault.adapter.exists(cur))) {
			await app.vault.adapter.mkdir(cur);
		}
	}
}

export async function writeBook(
	app: App,
	book: Book,
	settings: PaperFolioSettings,
	state: State
): Promise<BookStats> {
	await ensureFolder(app, settings.outputFolder);
	const filename = bookFilename(book, settings.filenameFormat);
	const path = normalizePath(`${settings.outputFolder}/${filename}`);

	const newCount = book.bookmarks.filter((b) =>
		state.isNewOrChanged(b)
	).length;
	const highlights = book.bookmarks.filter(
		(b) => b.type === "highlight" || b.type === "note"
	).length;
	const dogears = book.bookmarks.filter((b) => b.type === "dogear").length;

	const block = buildKoboBlock(book, settings);

	let content: string;
	if (await app.vault.adapter.exists(path)) {
		const existing = await app.vault.adapter.read(path);
		content = mergeIntoExisting(existing, block);
		if (content === existing) {
			// 內容沒變:仍更新指紋，但不重寫檔
			for (const b of book.bookmarks) state.mark(b);
			return { filename, written: false, new: 0, highlights, dogears };
		}
	} else {
		content = newFileContent(book, block);
	}

	await app.vault.adapter.write(path, content);
	for (const b of book.bookmarks) state.mark(b);
	return { filename, written: true, new: newCount, highlights, dogears };
}

// ---------- 索引 MOC ----------

export type IndexRow = [title: string, highlights: number, dogears: number, filename: string];

export async function writeIndex(
	app: App,
	rows: IndexRow[],
	settings: PaperFolioSettings
): Promise<void> {
	await ensureFolder(app, settings.outputFolder);
	const path = normalizePath(`${settings.outputFolder}/${INDEX_NAME}`);

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

	const lines = [
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
	];
	await app.vault.adapter.write(path, lines.join("\n"));
}
