// EPUB 章節目錄 fallback(僅 USB):899 對不到章節名時，開 kepub/epub 的 toc.ncx / nav.xhtml 補。
// 移植自 Python epub.py。真實資料實測:讓章節覆蓋率 34%→75%(救回 30 本商店書)。
// 純 Node(fs)+ fflate 解壓 + regex 解析，無 Obsidian 依賴，可離線測。
//
// 發現(道哥真實 Kobo):
// - 商店書 VolumeID 是 UUID，實體檔在 .kobo/kepub/<UUID>(無副檔名)。
// - 商店書 content.Title 對章節存的是內部檔名，真章節名要從 toc.ncx / nav.xhtml 取。
// - ContentID 分隔:商店書單 !(UUID!OEBPS!ch.xhtml)，側載書雙 !!(...epub!!OEBPS/Text/ch.xhtml)。

import * as fs from "fs";
import * as path from "path";
import { unzipSync } from "fflate";
import type { Book } from "./types";
import { sortBookmarks } from "./parser";

// VolumeID → 掛載卷上的實體 EPUB/kepub 檔。商店書(UUID)與側載書都處理。
export function resolveEpubPath(
	volumeId: string,
	volumeRoot: string
): string | null {
	const vid = volumeId;

	// 側載書:file:///mnt/onboard/Book.kepub.epub
	if (vid.startsWith("file://") || vid.includes("/mnt/onboard/")) {
		const p = vid.startsWith("file://") ? vid.slice("file://".length) : vid;
		const marker = "/mnt/onboard/";
		const rel = p.includes(marker)
			? p.slice(p.indexOf(marker) + marker.length)
			: p.replace(/^\/+/, "");
		const cand = path.join(volumeRoot, rel);
		if (fs.existsSync(cand)) return cand;
	}

	// 商店書:VolumeID 是 UUID → .kobo/kepub/<UUID>
	const bare = vid.split("/").pop() ?? vid;
	for (const cand of [
		path.join(volumeRoot, ".kobo", "kepub", bare),
		path.join(volumeRoot, ".kobo", "kepub", vid),
	]) {
		if (fs.existsSync(cand)) return cand;
	}
	return null;
}

// 取出章節在 zip 內的相對路徑(處理單 ! 與雙 !! 兩種分隔)。
export function internalChapterPath(contentId: string): string | null {
	let src = contentId || "";
	if (src.includes("!!")) {
		src = src.slice(src.indexOf("!!") + 2); // 側載:...epub!!OEBPS/Text/ch01.xhtml
	} else if (src.includes("!")) {
		const parts = src.split("!"); // 商店:UUID!OEBPS!ch.xhtml → OEBPS/ch.xhtml
		src = parts.slice(1).join("/");
	}
	src = src.split("#")[0].replace(/^\/+/, "").replace(/\/+$/, "");
	return src || null;
}

export function chapterBasename(contentId: string): string {
	const p = internalChapterPath(contentId) ?? contentId;
	return p.split("/").pop() ?? p;
}

const tocCache = new Map<string, Map<string, { title: string; index: number }>>();

// 從 toc.ncx / nav.xhtml 取 { 章節檔名basename: (真章節名, 目錄順序) }。
export function chapterTitles(
	epubPath: string
): Map<string, { title: string; index: number }> {
	const cached = tocCache.get(epubPath);
	if (cached) return cached;

	let result = new Map<string, { title: string; index: number }>();
	try {
		const bytes = new Uint8Array(fs.readFileSync(epubPath));
		// 只解壓 toc(ncx/nav)這一兩個 entry，不解整本，省時。
		const files = unzipSync(bytes, {
			filter: (f) =>
				f.name.toLowerCase().endsWith(".ncx") ||
				(/nav/i.test(f.name) && /\.(xhtml|html)$/i.test(f.name)),
		});
		const names = Object.keys(files);
		const ncx = names.find((n) => n.toLowerCase().endsWith(".ncx"));
		const dec = new TextDecoder("utf-8");
		if (ncx) {
			result = parseNcx(dec.decode(files[ncx]));
		} else {
			const nav = names.find(
				(n) => /nav/i.test(n) && /\.(xhtml|html)$/i.test(n)
			);
			if (nav) result = parseNav(dec.decode(files[nav]));
		}
	} catch (e) {
		// BadZip / 讀檔失敗 → 回空，交給呼叫端 fallback(留白)
	}
	tocCache.set(epubPath, result);
	return result;
}

// toc.ncx:navPoint 內 <text>標題</text> 與 <content src="檔案#anchor"/>。
function parseNcx(xml: string): Map<string, { title: string; index: number }> {
	const out = new Map<string, { title: string; index: number }>();
	let order = 0;
	const navRe = /<navPoint\b[\s\S]*?<\/navPoint>/g;
	let m: RegExpExecArray | null;
	while ((m = navRe.exec(xml)) !== null) {
		const block = m[0];
		const label = /<text>([\s\S]*?)<\/text>/.exec(block);
		const src = /<content[^>]*\bsrc="([^"]+)"/.exec(block);
		if (!label || !src) continue;
		const title = label[1].replace(/\s+/g, " ").trim();
		const base = (src[1].split("#")[0].split("/").pop() ?? "").trim();
		if (base && !out.has(base)) {
			out.set(base, { title, index: order });
			order += 1;
		}
	}
	return out;
}

// nav.xhtml:<a href="檔案#anchor">標題</a>。
function parseNav(xml: string): Map<string, { title: string; index: number }> {
	const out = new Map<string, { title: string; index: number }>();
	let order = 0;
	const aRe = /<a[^>]*\bhref="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
	let m: RegExpExecArray | null;
	while ((m = aRe.exec(xml)) !== null) {
		const href = m[1];
		const title = m[2].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
		const base = (href.split("#")[0].split("/").pop() ?? "").trim();
		if (base && title && !out.has(base)) {
			out.set(base, { title, index: order });
			order += 1;
		}
	}
	return out;
}

// 899 對不到章節名時，開 epub 的 toc 補，並重排。移植自 pipeline._enrich_chapter_titles。
export function enrichChapterTitles(
	book: Book,
	volumeRoot: string | null
): void {
	if (!volumeRoot) return; // 無線模式沒有掛載卷 → 跳過
	if (book.bookmarks.every((b) => b.chapterTitle)) return; // 全部已有真章節名
	const epubPath = resolveEpubPath(book.volumeId, volumeRoot);
	if (!epubPath) return;
	const titles = chapterTitles(epubPath);
	if (titles.size === 0) return;
	for (const b of book.bookmarks) {
		if (b.chapterTitle) continue;
		const t = titles.get(chapterBasename(b.contentId));
		if (t) {
			b.chapterTitle = t.title;
			b.chapterIndex = t.index;
		}
	}
	sortBookmarks(book.bookmarks);
}
