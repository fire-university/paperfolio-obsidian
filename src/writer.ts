// 檔案 I/O 層:把排版好的字串用 Obsidian Vault API 寫進 vault。
// 純排版邏輯在 format.ts;此檔只負責「寫到哪、怎麼合併既有檔」。
// 只重寫 <!-- KOBO:START/END --> 之間，區塊外(含手寫總結)永不動。

import { App, normalizePath } from "obsidian";
import type { Book } from "./types";
import type { PaperFolioSettings } from "./settings";
import type { State } from "./state";
import {
	bookFilename,
	buildKoboBlock,
	newFileContent,
	mergeIntoExisting,
	buildIndexContent,
	INDEX_NAME,
	IndexRow,
} from "./format";

export type { IndexRow } from "./format";

export interface BookStats {
	filename: string;
	written: boolean;
	new: number;
	highlights: number;
	dogears: number;
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

export async function writeIndex(
	app: App,
	rows: IndexRow[],
	settings: PaperFolioSettings
): Promise<void> {
	await ensureFolder(app, settings.outputFolder);
	const path = normalizePath(`${settings.outputFolder}/${INDEX_NAME}`);
	await app.vault.adapter.write(path, buildIndexContent(rows, settings));
}
