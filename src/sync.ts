// 串接:門檻過濾 → 增量 → Obsidian 輸出 → 索引。
// 移植自 Python pipeline.py。Phase 1 不做 epub 章節補齊(章節名已由 parser 從 899 取得)。

import { App, normalizePath } from "obsidian";
import type { Book } from "./types";
import type { PaperFolioSettings } from "./settings";
import type { State } from "./state";
import { writeBook, writeIndex, IndexRow } from "./writer";
import { enrichChapterTitles, ChapterCache } from "./epub";
import { indexFilename } from "./format";
import { t } from "./i18n";

// 索引狀態:檔名 → [書名, 畫線數, 折頁數]。持久化在 data.json，跨同步累積,
// 這樣只同步部分來源(例如只有 Kobo Desktop)時，索引不會縮水成只剩本次那幾本。
export type IndexState = Record<string, [string, number, number]>;

export interface SyncResult {
	books: number;
	highlights: number;
	dogears: number;
	newItems: number;
	filesWritten: number;
	skippedBooks: number;
}

export function summarize(r: SyncResult): string {
	const extra = r.skippedBooks
		? t("summary_extra", { n: r.skippedBooks })
		: "";
	return t("summary", {
		h: r.highlights,
		d: r.dogears,
		books: r.books,
		extra,
	});
}

// 升級相容:indexState 還是空的時候，從既有的索引檔回填，
// 避免第一次只同步部分來源(例如只有 Kobo Desktop)就把索引洗成只剩那幾本。
async function seedIndexState(
	app: App,
	settings: PaperFolioSettings,
	indexState: IndexState
): Promise<void> {
	if (Object.keys(indexState).length > 0) return;
	const p = normalizePath(`${settings.outputFolder}/${indexFilename()}`);
	if (!(await app.vault.adapter.exists(p))) return;
	const text = await app.vault.adapter.read(p);
	const row =
		/^\|\s*\[\[(.+?)\\\|(.+?)\]\]\s*\|\s*(\d+)\s*\|(?:\s*(\d+)\s*\|)?\s*$/;
	for (const line of text.split("\n")) {
		const m = row.exec(line.trim());
		if (!m) continue;
		const stem = m[1];
		const title = m[2].replace(/^《|》$/g, "");
		indexState[`${stem}.md`] = [title, parseInt(m[3], 10) || 0, parseInt(m[4], 10) || 0];
	}
}

export async function runSync(
	app: App,
	books: Book[],
	settings: PaperFolioSettings,
	state: State,
	volumeRoots: string[],
	chapterCache: ChapterCache,
	indexState: IndexState
): Promise<SyncResult> {
	const result: SyncResult = {
		books: 0,
		highlights: 0,
		dogears: 0,
		newItems: 0,
		filesWritten: 0,
		skippedBooks: 0,
	};
	await seedIndexState(app, settings, indexState);

	for (const book of books) {
		const total = book.bookmarks.filter(
			(b) => b.type !== "dogear" || settings.includeDogears
		).length;
		if (total < settings.minAnnotations) {
			result.skippedBooks++;
			continue;
		}

		// 899 對不到章節名的書(多為缺 TOC 的商店書)，開 epub 補章節名並重排，
		// 同時把章節表存進快取(供無線模式沿用)
		enrichChapterTitles(book, volumeRoots, chapterCache);

		const stats = await writeBook(app, book, settings, state);
		result.books++;
		result.highlights += stats.highlights;
		result.dogears += stats.dogears;
		result.newItems += stats.new;
		if (stats.written) result.filesWritten++;
		indexState[stats.filename] = [
			book.title,
			stats.highlights,
			stats.dogears,
		];
	}

	// 索引以累積狀態產生;先清掉輸出資料夾已不存在的書，避免列出孤兒
	for (const fname of Object.keys(indexState)) {
		const p = normalizePath(`${settings.outputFolder}/${fname}`);
		if (!(await app.vault.adapter.exists(p))) delete indexState[fname];
	}
	const rows: IndexRow[] = Object.keys(indexState).map((fname) => {
		const [title, h, d] = indexState[fname];
		return [title, h, d, fname];
	});

	await writeIndex(app, rows, settings);
	return result;
}
