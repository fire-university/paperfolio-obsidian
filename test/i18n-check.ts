// 驗證 i18n:en/zh 兩語言渲染 + 哨兵跨語言相容(切語言不會重複插入區塊)。
import { setLang } from "../src/i18n";
import {
	newFileContent,
	buildKoboBlock,
	buildIndexContent,
	BLOCK_RE,
	mergeIntoExisting,
} from "../src/format";
import { t } from "../src/i18n";
import { DEFAULT_SETTINGS } from "../src/settings";

const book: any = {
	volumeId: "v",
	title: "人生4千個禮拜",
	author: "Oliver Burkeman",
	isbn: "123",
	bookmarks: [
		{
			bookmarkId: "a",
			volumeId: "v",
			contentId: "c",
			type: "highlight",
			text: "要事第一",
			annotation: "我的心得",
			color: null,
			dateCreated: "2026-01-01",
			dateModified: "",
			containerPath: "span#kobo.2.1",
			startOffset: 0,
			chapterProgress: 0.1,
			chapterTitle: "前言",
			chapterIndex: 0,
		},
	],
};
const s = { ...DEFAULT_SETTINGS };

for (const lang of ["en", "zh-TW"] as const) {
	setLang(lang);
	console.log(`\n========== ${lang} ==========`);
	console.log(newFileContent(book, buildKoboBlock(book, s)));
	console.log(
		"index summary:",
		buildIndexContent([["人生4千個禮拜", 10, 0, "book.md"]], s).split("\n")[7]
	);
	console.log(
		"summary notice:",
		t("summary", { h: 3622, d: 0, books: 66, extra: t("summary_extra", { n: 14 }) })
	);
}

// 相容性:zh 產生的檔，之後在 en 模式重同步 → 哨兵要對得到、不能重複插入
setLang("zh-TW");
const zhFile = newFileContent(book, buildKoboBlock(book, s));
setLang("en");
console.log("\n========== 哨兵跨語言相容 ==========");
console.log("en 的 BLOCK_RE 能對到 zh 檔哨兵:", BLOCK_RE.test(zhFile));
const merged = mergeIntoExisting(zhFile, buildKoboBlock(book, s));
console.log(
	"zh 檔用 en 重同步後 KOBO:START 次數(應為 1):",
	(merged.match(/KOBO:START/g) || []).length
);
