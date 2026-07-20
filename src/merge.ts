// 合併多個來源的書（Kobo 裝置 ＋ Kobo Desktop 本機資料庫）。
// 純函式、零 Obsidian 依賴，可離線測。
// 規則:同一本書以 volumeId 為準;同一條畫線以 BookmarkID 去重、取較新的那份。

import type { Book } from "./types";
import { sortBookmarks } from "./parser";

const stamp = (b: { dateModified: string; dateCreated: string }) =>
	b.dateModified || b.dateCreated || "";

export function mergeBooks(lists: Book[][]): Book[] {
	const byVolume = new Map<string, Book>();

	for (const list of lists) {
		for (const src of list) {
			const cur = byVolume.get(src.volumeId);
			if (!cur) {
				byVolume.set(src.volumeId, { ...src, bookmarks: [...src.bookmarks] });
				continue;
			}
			// 書層 metadata:補上缺的
			if (!cur.title && src.title) cur.title = src.title;
			if (!cur.author && src.author) cur.author = src.author;
			if (!cur.isbn && src.isbn) cur.isbn = src.isbn;

			const seen = new Map(cur.bookmarks.map((b) => [b.bookmarkId, b]));
			for (const nb of src.bookmarks) {
				const old = seen.get(nb.bookmarkId);
				if (!old) {
					cur.bookmarks.push(nb);
					seen.set(nb.bookmarkId, nb);
				} else if (stamp(nb) > stamp(old)) {
					Object.assign(old, nb); // 較新的覆蓋(含章節資訊)
				}
			}
		}
	}

	const out = Array.from(byVolume.values());
	for (const b of out) sortBookmarks(b.bookmarks);
	return out;
}
