// 章節目錄:每本書自動區塊最前面的「章節＋畫線數」表。
//
//   npx tsx test/chapter-toc-check.ts

import { buildKoboBlock, blockItemCount } from "../src/format";
import { DEFAULT_SETTINGS } from "../src/settings";
import { setLang } from "../src/i18n";

let bad = 0;
const check = (label: string, ok: boolean, detail = "") => {
	console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? "  " + detail : ""}`);
	if (!ok) bad++;
};

const bm = (i: number, ch: string) => ({
	bookmarkId: `b${i}`, volumeId: "v", contentId: "c", type: "highlight",
	text: `畫線 ${i}`, annotation: "", color: null,
	dateCreated: "2026-01-01", dateModified: "", containerPath: "",
	startOffset: 0, chapterProgress: 0, chapterTitle: ch, chapterIndex: 0,
});
const book = (chs: string[]): any => ({
	volumeId: "v", title: "書", author: "作者", isbn: "1",
	bookmarks: chs.map((c, i) => bm(i, c)),
});

setLang("zh-TW");
const s = { ...DEFAULT_SETTINGS };

console.log("多章節:有目錄、數量正確");
let b = buildKoboBlock(book(["前言", "前言", "第１章　接受人生有限", "第１章　接受人生有限", "第１章　接受人生有限"]), s);
check("有表頭", b.includes("| 章節 | 畫線數 |"));
check("前言 2 條", b.includes("| [[#前言\\|前言]] | 2 |"));
check("第１章 3 條", b.includes("| [[#第１章　接受人生有限\\|第１章　接受人生有限]] | 3 |"));
check("目錄在第一個章節標題之前", b.indexOf("| 章節 |") < b.indexOf("## 前言"));
check("items 不含目錄", blockItemCount(b) === 5);

console.log("特殊字元:連結目標換成空格、顯示保留");
b = buildKoboBlock(book(["A: B?", "C#D"]), s);
check("冒號問號", b.includes("[[#A  B \\|A: B?]]"));
check("井號", b.includes("[[#C D\\|C#D]]"));

console.log("不該出現的情況");
check("只有一章不產生", !buildKoboBlock(book(["唯一"]), s).includes("| 章節 |"));
check("沒章節名不產生", !buildKoboBlock(book(["", ""]), s).includes("| 章節 |"));
check("關閉設定不產生", !buildKoboBlock(book(["a", "b"]), { ...s, chapterToc: false }).includes("| 章節 |"));
check("不分章節時不產生", !buildKoboBlock(book(["a", "b"]), { ...s, groupByChapter: false }).includes("| 章節 |"));

console.log("英文");
setLang("en");
check("英文表頭", buildKoboBlock(book(["a", "b"]), s).includes("| Chapter | Highlights |"));

console.log(bad ? `\n${bad} 項失敗` : "\n全部通過");
process.exit(bad ? 1 : 0);
