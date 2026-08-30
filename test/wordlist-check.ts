// 驗證生詞交接檔:mergeWords 的合併規則 ＋ readWordList 對真實 KoboReader.sqlite。
// 用法: node wordlist-check.cjs [KoboReader.sqlite 路徑]
import * as fs from "fs";
import { readWordList } from "../src/parser";
import { mergeWords, parseWordListFile } from "../src/wordlist";
import type { KoboWord } from "../src/types";

let failed = 0;
function check(name: string, cond: boolean, extra = ""): void {
	if (cond) {
		console.log(`  ok   ${name}`);
	} else {
		failed++;
		console.log(`  FAIL ${name} ${extra}`);
	}
}

const w = (text: string, date: string, book = "B"): KoboWord => ({
	text,
	book,
	dict: "-en-zh-TW",
	date,
});

async function main() {
	console.log("mergeWords");
	const base = [w("marble", "2026-08-30T04:07:57Z")];

	const added = mergeWords(base, [w("obituary", "2026-08-30T04:08:27Z")]);
	check("新字會加進來", added.length === 2);
	check("依時間排序", added[0].text === "marble");

	const dup = mergeWords(base, [w("Marble", "2026-08-31T00:00:00Z", "另一本")]);
	check("同一個字不分大小寫只留一筆", dup.length === 1);
	check("重複時保留最早那次的書名", dup[0].book === "B", `got ${dup[0].book}`);

	const kept = mergeWords(base, []);
	check("Kobo 上刪掉的字不會被清掉(只增不減)", kept.length === 1);

	const empty = mergeWords([], [w("  ", "2026-08-30T00:00:00Z")]);
	check("空字串不進檔", empty.length === 0);

	console.log("parseWordListFile");
	check("壞掉的 JSON 回空陣列而不是丟例外", parseWordListFile("{oops").length === 0);
	check(
		"讀得回自己寫出去的格式",
		parseWordListFile(JSON.stringify({ version: 1, words: base })).length === 1
	);

	const dbPath = process.argv[2];
	if (dbPath) {
		console.log(`readWordList(${dbPath})`);
		const words = await readWordList(new Uint8Array(fs.readFileSync(dbPath)));
		console.log(`  讀到 ${words.length} 個字`);
		for (const x of words) {
			console.log(`   - ${x.text} [${x.dict}] ${x.date} :: ${x.book}`);
		}
		check("每個字都有來源書名", words.every((x) => !!x.book));
	} else {
		console.log("readWordList: 略過(沒給 DB 路徑)");
	}

	console.log(failed === 0 ? "\n全部通過" : `\n${failed} 項失敗`);
	process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
