// 檔案 I/O 層:把排版好的字串用 Obsidian Vault API 寫進 vault。
// 純排版邏輯在 format.ts;此檔只負責「寫到哪、怎麼合併既有檔」。
// 只重寫 <!-- KOBO:START/END --> 之間，區塊外(含手寫總結)永不動。

import { App, normalizePath } from "obsidian";
import type { Book, KoboWord } from "./types";
import type { PaperFolioSettings } from "./settings";
import type { State } from "./state";
import {
	buildWordListContent,
	mergeWords,
	parseWordListFile,
	wordListPath,
	WordListResult,
} from "./wordlist";
import {
	shrinkGuard,
	bookFilename,
	buildKoboBlock,
	newFileContent,
	mergeIntoExisting,
	buildIndexContent,
	indexFilename,
	IndexRow,
} from "./format";

export type { IndexRow } from "./format";

export interface BookStats {
	filename: string;
	written: boolean;
	new: number;
	highlights: number;
	dogears: number;
	// 因為畫線變少而沒有覆蓋時填這兩個(筆記原本幾條 → 這次只產出幾條)
	shrunkFrom?: number;
	shrunkTo?: number;
	title?: string; // 給摘要點名用
}

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

	const newCount = book.bookmarks.filter((b) => state.isNewOrChanged(b)).length;
	const highlights = book.bookmarks.filter(
		(b) => b.type === "highlight" || b.type === "note"
	).length;
	const dogears = book.bookmarks.filter((b) => b.type === "dogear").length;

	const block = buildKoboBlock(book, settings);

	let content: string;
	if (await app.vault.adapter.exists(path)) {
		const existing = await app.vault.adapter.read(path);
		// 變少就不覆蓋。裝置重置或同步到一半時,整塊取代會把筆記截斷,
		// 而且完全不出聲——2026-09-18 一天內兩次。要解除:把該筆記哨兵裡的
		// items=N 刪掉或改小,下次同步就會正常覆蓋。
		const shrink = shrinkGuard(existing, block);
		if (shrink) {
			return {
				filename,
				written: false,
				new: 0,
				highlights,
				dogears,
				shrunkFrom: shrink.from,
				shrunkTo: shrink.to,
				title: book.title,
			};
		}
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

// 生詞交接檔:合併既有內容後寫出。沒有新字就不重寫檔(避免每次同步都改檔案時間)。
export async function writeWordList(
	app: App,
	incoming: KoboWord[],
	settings: PaperFolioSettings
): Promise<WordListResult> {
	const p = normalizePath(wordListPath(settings));
	const existing = (await app.vault.adapter.exists(p))
		? parseWordListFile(await app.vault.adapter.read(p))
		: [];
	const merged = mergeWords(existing, incoming);
	const added = Math.max(merged.length - existing.length, 0);

	if (added === 0 && existing.length > 0) {
		return { total: merged.length, added: 0 };
	}

	const folder = p.split("/").slice(0, -1).join("/");
	if (folder) await ensureFolder(app, folder);
	await app.vault.adapter.write(p, buildWordListContent(merged, new Date()));
	return { total: merged.length, added };
}

export async function writeIndex(
	app: App,
	rows: IndexRow[],
	settings: PaperFolioSettings
): Promise<void> {
	await ensureFolder(app, settings.outputFolder);
	const path = normalizePath(`${settings.outputFolder}/${indexFilename()}`);
	await app.vault.adapter.write(path, buildIndexContent(rows, settings));
}
