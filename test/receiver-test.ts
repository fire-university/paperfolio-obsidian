// 離線驗證接收端:起 server，onSync 走「無線引擎路徑」(volumeRoot=null + 章節快取)。
// 用 curl 當 Kobo 打:/ping、缺/錯 token→401、真實 DB POST→200＋摘要。
import * as fs from "fs";
import { Receiver } from "../src/receiver";
import { readBookmarks } from "../src/parser";
import { enrichChapterTitles, ChapterCache } from "../src/epub";
import { DEFAULT_SETTINGS } from "../src/settings";

async function main() {
	const usbDb = process.argv[2];
	const volumeRoot = process.argv[3];
	const port = parseInt(process.argv[4] || "8799", 10);
	const token = "testtoken123";

	// 先用 USB 建章節快取(模擬使用者曾插線同步過)
	const cache: ChapterCache = {};
	const usbBooks = await readBookmarks(new Uint8Array(fs.readFileSync(usbDb)));
	for (const b of usbBooks) enrichChapterTitles(b, volumeRoot, cache);
	console.error(`[setup] 章節快取建好：${Object.keys(cache).length} 本`);

	const rx = new Receiver({
		port,
		token,
		onSync: async (bytes) => {
			// 無線路徑:volumeRoot=null，章節只能靠快取
			const books = await readBookmarks(bytes);
			let hit = 0;
			let miss = 0;
			let hl = 0;
			for (const bk of books) {
				const total = bk.bookmarks.filter((x) => x.type !== "dogear").length;
				if (total < DEFAULT_SETTINGS.minAnnotations) continue;
				enrichChapterTitles(bk, null, cache);
				for (const x of bk.bookmarks)
					if (x.type === "highlight" || x.type === "note") {
						hl++;
						x.chapterTitle ? hit++ : miss++;
					}
			}
			const pct = hit + miss ? Math.round((100 * hit) / (hit + miss)) : 0;
			return `已匯入 ${hl} 條畫線（章節 ${pct}%，無線走快取）`;
		},
	});
	await rx.start();
	console.error(`[ready] listening 0.0.0.0:${port}`);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
