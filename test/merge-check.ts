// 驗證多來源合併:裝置 DB ＋ Kobo Desktop DB → 合併、章節補齊(兩邊 kepub 都試)。
// 用法: node merge-check.cjs <裝置db> <desktop db> <desktop 資料目錄> [裝置卷根]
import * as fs from "fs";
import { readBookmarks } from "../src/parser";
import { mergeBooks } from "../src/merge";
import { enrichChapterTitles, ChapterCache } from "../src/epub";
import { DEFAULT_SETTINGS } from "../src/settings";

async function main() {
	const [devDb, deskDb, deskRoot, volRoot] = process.argv.slice(2);
	const s = { ...DEFAULT_SETTINGS };

	const dev = await readBookmarks(new Uint8Array(fs.readFileSync(devDb)));
	const desk = await readBookmarks(new Uint8Array(fs.readFileSync(deskDb)));

	const count = (bs: any[]) =>
		bs.reduce(
			(n, b) =>
				n + b.bookmarks.filter((x: any) => x.type !== "dogear").length,
			0
		);
	console.log("=== 各來源 ===");
	console.log(`  裝置:      ${dev.length} 本書, ${count(dev)} 條畫線/筆記`);
	console.log(`  Desktop:   ${desk.length} 本書, ${count(desk)} 條畫線/筆記`);

	const merged = mergeBooks([dev, desk]);
	console.log("\n=== 合併後 ===");
	console.log(`  合計:      ${merged.length} 本書, ${count(merged)} 條畫線/筆記`);
	const gained = count(merged) - count(dev);
	console.log(`  比只讀裝置多拿到: ${gained} 條`);

	// 章節補齊:兩個根目錄都試(裝置 .kobo/kepub 與 Desktop kepub)
	const roots = [volRoot, deskRoot].filter(Boolean) as string[];
	const cache: ChapterCache = {};
	let hit = 0,
		miss = 0,
		imported = 0;
	for (const b of merged) {
		const total = b.bookmarks.filter(
			(x) => x.type !== "dogear" || s.includeDogears
		).length;
		if (total < s.minAnnotations) continue;
		imported++;
		enrichChapterTitles(b, roots, cache);
		for (const x of b.bookmarks)
			if (x.type === "highlight" || x.type === "note")
				x.chapterTitle ? hit++ : miss++;
	}
	const pct = hit + miss ? Math.round((100 * hit) / (hit + miss)) : 0;
	console.log(`\n=== 合併後章節（根目錄: ${roots.length} 個）===`);
	console.log(`  匯入書數: ${imported}`);
	console.log(`  有真章節名: ${hit}/${hit + miss}（${pct}%）`);
	console.log(`  章節快取: ${Object.keys(cache).length} 本`);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
