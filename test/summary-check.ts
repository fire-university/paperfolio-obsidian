// 同步摘要一定要講出「這次讀了哪些來源」。
//
// 2026-09-18 的實例:道哥把 USB 退出之後才按同步,外掛安靜地只讀 Kobo Desktop,
// 畫面顯示「已匯入 …」看起來完全成功,但機器上的側載書(Naval 那本 122 條)
// 一條都沒進來。**成功與「只成功了一半」在畫面上長得一模一樣**,這正是這個
// 專案一再踩到的那種坑,所以摘要必須把來源寫出來。
//
//   npx tsx test/summary-check.ts

import { summarize, SyncResult } from "../src/format";
import { setLang, t } from "../src/i18n";

let bad = 0;
const check = (label: string, ok: boolean, detail = "") => {
	console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? "  " + detail : ""}`);
	if (!ok) bad++;
};

const base: SyncResult = {
	books: 3,
	highlights: 10,
	dogears: 0,
	newItems: 10,
	filesWritten: 3,
	skippedBooks: 0,
};

for (const lang of ["en", "zh-TW"] as const) {
	setLang(lang);
	console.log(`\n== ${lang} ==`);

	// 今天那個情境:只有 Kobo Desktop
	const only = summarize({ ...base, sources: [t("src_desktop")] });
	check("只讀到 Desktop 時有講出來", only.includes(t("src_desktop")), only.replace(/\n/g, " / "));
	check("而且沒有謊稱讀了機器", !only.includes(t("src_device")));

	// 兩個來源都有
	const both = summarize({ ...base, sources: [t("src_device"), t("src_desktop")] });
	check(
		"兩個來源都列出",
		both.includes(t("src_device")) && both.includes(t("src_desktop")),
		both.replace(/\n/g, " / ")
	);

	// 舊呼叫端沒給 sources 時不能爆、也不能印出空的來源列
	const none = summarize(base);
	check("沒有 sources 時不顯示來源那一行", !none.includes(t("summary_sources", { list: "" }).trim()));
	check("沒有 sources 時仍然有正常摘要", none.includes(String(base.highlights)), none);
}

console.log(bad ? `\n[失敗] ${bad} 項` : "\n[通過] 來源一定會被寫進摘要");
process.exit(bad ? 1 : 0);
