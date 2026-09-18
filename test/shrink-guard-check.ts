// 畫線變少時不要覆蓋筆記。
//
// 2026-09-18 的實例:Kobo 更新到 5.x 測試版後被重置,《與成功有約》在機器上
// 只剩 20 條、筆記裡有 274 條。PaperFolio 是整塊取代,同步下去就會把 254 條
// 直接抹掉,而且畫面上看起來是一次成功的同步。同一天降版又重置了一次。
//
// 這支驗三件事:擋得住、不誤擋、擋下來時說得出是哪一本。
//
//   npx tsx test/shrink-guard-check.ts

import { buildKoboBlock, blockItemCount, shrinkGuard, summarize, SyncResult } from "../src/format";
import { DEFAULT_SETTINGS } from "../src/settings";
import { setLang, t } from "../src/i18n";

let bad = 0;
const check = (label: string, ok: boolean, detail = "") => {
	console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? "  " + detail : ""}`);
	if (!ok) bad++;
};

const bm = (i: number) => ({
	bookmarkId: `b${i}`, volumeId: "v", contentId: "c", type: "highlight",
	text: `畫線 ${i}`, annotation: "", color: null,
	dateCreated: "2026-01-01", dateModified: "", containerPath: "",
	startOffset: 0, chapterProgress: 0, chapterTitle: "", chapterIndex: 0,
});
const book = (n: number): any => ({
	volumeId: "v", title: "與成功有約", author: "柯維", isbn: "1",
	bookmarks: Array.from({ length: n }, (_, i) => bm(i)),
});
const s = { ...DEFAULT_SETTINGS };
const blockOf = (n: number) => buildKoboBlock(book(n), s);

setLang("zh-TW");

console.log("哨兵");
check("哨兵帶得出條目數", blockItemCount(blockOf(274)) === 274, String(blockItemCount(blockOf(274))));
check("0 條也寫得出來", blockItemCount(blockOf(0)) === 0);

console.log("\n擋與不擋");
const big = blockOf(274);
check("274 → 20 要擋", JSON.stringify(shrinkGuard(big, blockOf(20))) === '{"from":274,"to":20}',
	JSON.stringify(shrinkGuard(big, blockOf(20))));
check("274 → 274 不擋（相等）", shrinkGuard(big, blockOf(274)) === null);
check("274 → 300 不擋（變多才是正常）", shrinkGuard(big, blockOf(300)) === null);
check("少一條也要擋", shrinkGuard(big, blockOf(273)) !== null);

console.log("\n相容與逃生門");
const legacy = big.replace(/ items=\d+/, ""); // 升級前的舊筆記
check("舊筆記沒有 items= → 放行，不會整批卡住", shrinkGuard(legacy, blockOf(20)) === null);
check("手動拿掉 items= 就解除防護", shrinkGuard(legacy, blockOf(1)) === null);

console.log("\n摘要要點名");
const r: SyncResult = {
	books: 5, highlights: 30, dogears: 0, newItems: 30, filesWritten: 5,
	skippedBooks: 0, shrunk: ["與成功有約 274→20", "The Art of Spending Money 53→26"],
};
const msg = summarize(r);
check("有講跳過幾本", msg.includes("2"), msg.split("\n").pop() ?? "");
check("有點名書名", msg.includes("與成功有約 274→20"));
check("有告訴使用者怎麼解除", msg.includes("items="));
const clean = summarize({ ...r, shrunk: [] });
check("沒有被擋時不顯示這一行", !clean.includes("items="), clean.replace(/\n/g, " / "));

setLang("en");
const en = summarize(r);
check("英文也點名", en.includes("與成功有約 274→20") && en.includes("items="));

console.log(bad ? `\n[失敗] ${bad} 項` : "\n[通過] 變少會被擋下來並點名，變多與相等照常寫入");
process.exit(bad ? 1 : 0);
