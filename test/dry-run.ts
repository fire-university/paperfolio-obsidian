// 離線端到端演練:對真實 KoboReader.sqlite 跑 parser + format(與外掛同一份程式)，
// 把真的筆記檔寫到指定輸出資料夾，並印統計。不碰 Obsidian、不碰 vault。
// 用法(node bundle): node dry-run.cjs <db.sqlite> <輸出資料夾>
import * as fs from "fs";
import * as path from "path";
import { readBookmarks } from "../src/parser";
import { enrichChapterTitles } from "../src/epub";
import { DEFAULT_SETTINGS, PaperFolioSettings } from "../src/settings";
import {
	bookFilename,
	buildKoboBlock,
	newFileContent,
	buildIndexContent,
	IndexRow,
} from "../src/format";

async function main() {
	const dbPath = process.argv[2];
	const outDir = process.argv[3];
	const volumeRoot = process.argv[4] || null; // 掛載卷根目錄，供 epub fallback
	const settings: PaperFolioSettings = { ...DEFAULT_SETTINGS };

	const books = await readBookmarks(new Uint8Array(fs.readFileSync(dbPath)));
	fs.mkdirSync(outDir, { recursive: true });

	const index: IndexRow[] = [];
	let imported = 0;
	let skipped = 0;
	let totalH = 0;
	let totalD = 0;
	let chHit = 0; // 匯入書中，有真章節名的畫線/筆記數(enrich 後)
	let chMiss = 0;

	for (const book of books) {
		const total = book.bookmarks.filter(
			(b) => b.type !== "dogear" || settings.includeDogears
		).length;
		if (total < settings.minAnnotations) {
			skipped++;
			continue;
		}
		enrichChapterTitles(book, volumeRoot);
		for (const b of book.bookmarks) {
			if (b.type === "highlight" || b.type === "note") {
				b.chapterTitle ? chHit++ : chMiss++;
			}
		}
		const highlights = book.bookmarks.filter(
			(b) => b.type === "highlight" || b.type === "note"
		).length;
		const dogears = book.bookmarks.filter((b) => b.type === "dogear").length;
		const block = buildKoboBlock(book, settings);
		const filename = bookFilename(book, settings.filenameFormat);
		fs.writeFileSync(
			path.join(outDir, filename),
			newFileContent(book, block),
			"utf8"
		);
		index.push([book.title, highlights, dogears, filename]);
		imported++;
		totalH += highlights;
		totalD += dogears;
	}
	fs.writeFileSync(
		path.join(outDir, "00_Kobo 畫線索引.md"),
		buildIndexContent(index, settings),
		"utf8"
	);

	// --- 統計與健檢 ---
	console.log(
		`書共 ${books.length} 本，匯入 ${imported}，略過 ${skipped}（門檻 <${settings.minAnnotations}）`
	);
	console.log(
		`畫線＋筆記 ${totalH} 條，折頁 ${totalD} 個（include_dogears=${settings.includeDogears}）`
	);

	// 真章節名覆蓋率(匯入書、enrich 後)
	const pct = chHit + chMiss ? Math.round((100 * chHit) / (chHit + chMiss)) : 0;
	console.log(`有真章節名的畫線: ${chHit}/${chHit + chMiss}（${pct}%）`);

	// 沒對到書名(用檔名 fallback)的書
	const noTitle = books.filter((b) => !b.title || b.title === "未命名書籍");
	console.log(`書名 fallback 的書: ${noTitle.length}`);

	// 前 8 名(依畫線數)
	const top = [...index].sort((a, b) => b[1] - a[1]).slice(0, 8);
	console.log("\n畫線最多的前 8 本:");
	for (const [t, h, d] of top) console.log(`  《${t}》 ${h} 條` + (settings.includeDogears ? ` / ${d} 折頁` : ""));
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
