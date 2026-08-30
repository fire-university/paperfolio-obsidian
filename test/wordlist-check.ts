// 驗證生詞交接檔:mergeWords 的合併規則 ＋ readWordList 對真實 KoboReader.sqlite。
// 用法: node wordlist-check.cjs [KoboReader.sqlite 路徑]
import * as fs from "fs";
import { readWordList } from "../src/parser";
import { mergeWords, parseWordListFile } from "../src/wordlist";
import { sentenceAround, stripXhtml } from "../src/wordctx";
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
	volumeId: "uuid",
	dict: "-en-zh-TW",
	date,
});

// 一段真的長得像書裡的文字(標籤、彎引號、縮寫、跨段)。
const PAGE = `<p>He bought a <i>marble</i> countertop. It cost $4,000.</p>
<p>“That’s the predominant mood among policy-makers,” Dr. Smith said. Nothing more.</p>
<h2>Horsepower</h2>`;

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

	console.log("原句擷取");
	const text = stripXhtml(PAGE);
	check("標籤拿掉", !text.includes("<"), text.slice(0, 40));

	const marble = sentenceAround(text, "marble");
	check("撈到含這個字的那一句", marble === "He bought a marble countertop.", String(marble));

	const pre = sentenceAround(text, "predominant");
	check(
		"彎引號與逗號都在句子裡",
		pre === "“That’s the predominant mood among policy-makers,” Dr. Smith said.",
		String(pre)
	);
	check("縮寫的點不算句尾(Dr. 沒有把句子切斷)", (pre ?? "").includes("Dr. Smith"));

	check("只有標題那個字不算一句話", sentenceAround(text, "Horsepower") === null);
	check("大小寫不敏感", sentenceAround(text, "MARBLE") !== null);
	check(
		"不會被較長的字撈到(art ≠ countertop)",
		sentenceAround("a countertop appeared", "art") === null
	);
	check("書裡沒有的字回 null", sentenceAround(text, "obituary") === null);
	check("空字串不會爆", sentenceAround("", "marble") === null);

	console.log("原句只增不減");
	const withS: KoboWord = { ...w("marble", "2026-08-30T04:07:57Z"), sentence: "a sentence" };
	const later = mergeWords([withS], [w("marble", "2026-08-29T00:00:00Z")]);
	check("換成更早那筆時,已找到的原句要留著", later[0].sentence === "a sentence", String(later[0].sentence));
	const fill = mergeWords([w("marble", "2026-08-29T00:00:00Z")], [withS]);
	check("本來沒有原句的,後來補得上", fill[0].sentence === "a sentence", String(fill[0].sentence));

	console.log(failed === 0 ? "\n全部通過" : `\n${failed} 項失敗`);
	process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
