// 串接:門檻過濾 → 增量 → Obsidian 輸出 → 索引。
// 移植自 Python pipeline.py。Phase 1 不做 epub 章節補齊(章節名已由 parser 從 899 取得)。

import { App } from "obsidian";
import type { Book } from "./types";
import type { PaperFolioSettings } from "./settings";
import type { State } from "./state";
import { writeBook, writeIndex, IndexRow } from "./writer";
import { enrichChapterTitles, ChapterCache } from "./epub";

export interface SyncResult {
	books: number;
	highlights: number;
	dogears: number;
	newItems: number;
	filesWritten: number;
	skippedBooks: number;
}

export function summarize(r: SyncResult): string {
	const extra = r.skippedBooks ? `，略過 ${r.skippedBooks} 本零星書` : "";
	return `已匯入 ${r.highlights} 條畫線、${r.dogears} 個折頁（${r.books} 本書${extra}）`;
}

export async function runSync(
	app: App,
	books: Book[],
	settings: PaperFolioSettings,
	state: State,
	volumeRoot: string | null,
	chapterCache: ChapterCache
): Promise<SyncResult> {
	const result: SyncResult = {
		books: 0,
		highlights: 0,
		dogears: 0,
		newItems: 0,
		filesWritten: 0,
		skippedBooks: 0,
	};
	const index: IndexRow[] = [];

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
		enrichChapterTitles(book, volumeRoot, chapterCache);

		const stats = await writeBook(app, book, settings, state);
		result.books++;
		result.highlights += stats.highlights;
		result.dogears += stats.dogears;
		result.newItems += stats.new;
		if (stats.written) result.filesWritten++;
		index.push([book.title, stats.highlights, stats.dogears, stats.filename]);
	}

	await writeIndex(app, index, settings);
	return result;
}
