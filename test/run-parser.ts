// 離線驗證用:直接跑 parser.ts(readBookmarks)對一顆 sqlite，印出章節與排序。
// 不經過 Obsidian;用 esbuild 打包成 node CJS 執行(見 scratchpad 指令)。
import * as fs from "fs";
import { readBookmarks } from "../src/parser";

async function main() {
	const dbPath = process.argv[2];
	const bytes = new Uint8Array(fs.readFileSync(dbPath));
	const books = await readBookmarks(bytes);
	for (const b of books) {
		console.log(`\nBOOK 《${b.title}》 / ${b.author} / isbn=${b.isbn} (${b.bookmarks.length} 條)`);
		let order = 1;
		for (const bm of b.bookmarks) {
			console.log(
				`  ${order++}. [ch#${bm.chapterIndex} ${bm.chapterTitle}] ` +
					`span=${bm.containerPath} type=${bm.type} date=${bm.dateCreated} :: ${bm.text}` +
					(bm.annotation ? ` (附註:${bm.annotation})` : "")
			);
		}
	}
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
