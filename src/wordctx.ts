// 從書檔裡把「查這個字時的那一句」找回來。
//
// 為什麼需要:Kobo 的 `WordList` 只存單字、來源書、時間,**不存原句**。少了原句,
// 生詞筆記的「我遇到它的地方」就是一個空標題,複習卡也少掉最重要的那層線索。
//
// 能不能做得到,取決於書檔加密與否。實測道哥的 Kobo(2026-08-30,229 本):
//   - **商店書的內文是加密的**。The Art of Spending Money 的 33 個內文檔裡只有
//     1 個是明文(通常是版權頁那種附屬檔),真正的章節全部解不開。隨機 20 本
//     共 601 個內文檔,明文只有 65 個。
//   - **完全明文的書有,但少**:同一批 20 本裡有 5 本(側載書與無 DRM 的商店書)。
// 所以這件事的定位是「撈得到就補上」,不是「一定有」。解不開就回 null,
// 筆記維持沒有原句——**絕不試著解 DRM**。
//
// 只有書檔在本機時才做(USB 掛載的 Kobo、或 Kobo Desktop 的資料目錄);
// 純無線同步沒有書檔,那時就沒有原句。
//
// **畫線是更好的來源,而且不受 DRM 影響。** 畫線的文字是 Kobo 自己存進
// `Bookmark.Text` 的,加密的商店書照樣讀得到;而且那是使用者自己選的那一段,
// 比「這個字在書裡第一次出現的地方」更接近他當下看到的句子。所以順序是
// 先找畫線,再退回書檔。

import * as fs from "fs";
import { unzipSync } from "fflate";
import { resolveEpubPath } from "./epub";

/** 一句最多留這麼長。太長的段落當「一句」看只會把筆記塞爆。 */
const MAX_SENTENCE = 300;
/** 一本書最多找幾個字就放掉快取(整本純文字很佔記憶體)。 */
const TEXT_CACHE_LIMIT = 3;

const textCache = new Map<string, string[]>();

function decodeXhtml(bytes: Uint8Array): string {
	return new TextDecoder("utf-8").decode(bytes);
}

/** XHTML → 純文字。段落界線保留成換行,句子才不會跨段黏在一起。 */
export function stripXhtml(xhtml: string): string {
	return xhtml
		.replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
		.replace(/<\/(p|div|h[1-6]|li|blockquote)>/gi, "\n")
		.replace(/<br\s*\/?>/gi, "\n")
		.replace(/<[^>]+>/g, "")
		.replace(/&nbsp;/gi, " ")
		.replace(/&amp;/gi, "&")
		.replace(/&lt;/gi, "<")
		.replace(/&gt;/gi, ">")
		.replace(/&quot;/gi, '"')
		.replace(/&#39;|&rsquo;|&apos;/gi, "'")
		.replace(/&[a-z]+;|&#\d+;/gi, " ")
		.replace(/[ \t]+/g, " ")
		.replace(/\n{2,}/g, "\n");
}

/**
 * 句點不算句尾的情況:縮寫。
 *
 * 不處理的話 `Dr. Smith said` 會被切成兩句,撈出來的「一句」是半截的
 * ——那比沒有原句更糟,因為它看起來像資料壞了。
 */
const ABBREV = new Set([
	"mr", "mrs", "ms", "dr", "prof", "st", "jr", "sr", "inc", "ltd", "co",
	"vs", "etc", "eg", "ie", "al", "fig", "no", "vol", "pp", "approx",
]);

/** 這個位置的 `.` 是不是真的句尾(不是縮寫、也不是小數點)。 */
function periodEndsSentence(text: string, i: number): boolean {
	if (/[A-Za-z0-9]/.test(text[i + 1] ?? " ")) return false; // 3.5 / e.g
	let j = i - 1;
	while (j >= 0 && /[A-Za-z]/.test(text[j])) j--;
	const word = text.slice(j + 1, i).toLowerCase();
	if (!word) return true;
	// 單一字母多半是縮寫(J. K. Rowling),不是句尾。
	return word.length > 1 && !ABBREV.has(word);
}

/**
 * 從一段文字裡抓出包含 word 的那一句。
 *
 * 邊界用 `\b` 加上「不是字母」的兩側檢查,避免 `art` 撈到 `start`。
 * 句子邊界抓 `.?!` 加引號與換行——書裡的引號常常是彎引號,所以兩種都認。
 */
export function sentenceAround(text: string, word: string): string | null {
	const esc = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const re = new RegExp(`(^|[^A-Za-z'’-])(${esc})([^A-Za-z'’-]|$)`, "i");
	const m = re.exec(text);
	if (!m) return null;

	const at = m.index + m[1].length;
	const isEnd = (i: number) =>
		text[i] === "\n" ||
		text[i] === "!" ||
		text[i] === "?" ||
		(text[i] === "." && periodEndsSentence(text, i));

	let start = at;
	while (start > 0 && !isEnd(start - 1)) start--;
	let end = at + m[2].length;
	while (end < text.length && !isEnd(end)) end++;
	if (end < text.length) end++; // 把句點本身帶上

	const sentence = text.slice(start, end).replace(/\s+/g, " ").trim();
	if (!sentence || sentence.length > MAX_SENTENCE) return null;
	// 只有那個字本身(標題、目錄、索引)就不算一句話。
	if (sentence.replace(/[^A-Za-z]/g, "").length <= word.length + 2) return null;
	return sentence;
}

/** 把一本書的內文解成一段一段的純文字(照 zip 內檔名排序,約等於閱讀順序)。 */
function bookText(epubPath: string): string[] {
	const cached = textCache.get(epubPath);
	if (cached) return cached;

	let parts: string[] = [];
	try {
		const bytes = new Uint8Array(fs.readFileSync(epubPath));
		const files = unzipSync(bytes, {
			filter: (f) => /\.(xhtml|html)$/i.test(f.name) && !/nav/i.test(f.name),
		});
		parts = Object.keys(files)
			.sort()
			.map((n) => {
				const raw = decodeXhtml(files[n]);
				// **加密的檔要在這裡擋掉。** 解出來是二進位噪音,裡面照樣會隨機出現
				// `<`,所以不能只看有沒有標籤字元——那會讓 400KB 的亂碼進到後面的
				// 正規表示式裡(白跑,而且有機率撈出一段亂碼當「原句」)。
				// 認開頭:真的 XHTML 一定以 <?xml / <html / <!DOCTYPE 起頭。
				return /^\s*<(\?xml|html|!doctype)/i.test(raw.slice(0, 64))
					? stripXhtml(raw)
					: "";
			})
			.filter(Boolean);
	} catch (e) {
		// 開不了(加密、壞檔、不是 zip)→ 當作沒有內文,呼叫端就沒有原句可用。
		parts = [];
	}

	if (textCache.size >= TEXT_CACHE_LIMIT) {
		textCache.delete(textCache.keys().next().value as string);
	}
	textCache.set(epubPath, parts);
	return parts;
}

/** 配對用的畫線:哪一本、畫了什麼、什麼時候畫的。 */
export interface HighlightRef {
	volumeId: string;
	text: string;
	date: string;
}

/** 把畫線文字清乾淨:Kobo 常在尾巴留一串 tab,開頭偶爾多一個句點。 */
function tidy(text: string): string {
	return text.replace(/\s+/g, " ").replace(/^[\s.,;:]+/, "").trim();
}

/** 兩個時間差幾毫秒;有一邊解析不出來就當作無限遠(仍可比較,只是排最後)。 */
function gap(a: string, b: string): number {
	const ta = Date.parse(a);
	const tb = Date.parse(b);
	return Number.isFinite(ta) && Number.isFinite(tb)
		? Math.abs(ta - tb)
		: Number.MAX_SAFE_INTEGER;
}

/**
 * 從同一本書的畫線裡找包含這個字的那一句。
 *
 * 一個字可能出現在好幾條畫線裡,**取畫線時間離查詢時間最近的那條**——他是
 * 讀到那裡才查的,時間就是最可靠的線索。
 *
 * 畫線常常是一整段,所以先切出含那個字的那一句;切不出來而整條又夠短,
 * 就整條當原句(那本來就是他自己選的範圍)。
 */
export function sentenceFromHighlights(
	word: string,
	volumeId: string,
	when: string,
	highlights: HighlightRef[]
): string | null {
	const candidates = highlights
		.filter((h) => h.volumeId === volumeId && h.text)
		.map((h) => ({ h, text: tidy(h.text) }))
		.filter(({ text }) => sentenceAround(text, word) !== null || containsWord(text, word))
		.sort((a, b) => gap(a.h.date, when) - gap(b.h.date, when));

	for (const { text } of candidates) {
		const s = sentenceAround(text, word);
		if (s) return s;
		if (text.length <= MAX_SENTENCE) return text; // 整條就是他選的範圍
	}
	return null;
}

/** 這段文字裡有沒有這個字(整字比對,art 不算在 start 裡)。 */
export function containsWord(text: string, word: string): boolean {
	const esc = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	return new RegExp(`(^|[^A-Za-z'’-])${esc}([^A-Za-z'’-]|$)`, "i").test(text);
}

/**
 * 在書裡找這個字出現的那一句。找不到(或書檔讀不到)回 null。
 *
 * **回傳的是「書裡第一次出現的地方」,不保證就是他查字的那一句。** Kobo 沒有
 * 記位置,這是能拿到最接近的東西;同一個字在書裡通常也只出現一兩次(會查
 * 就表示不熟)。寧可給一句真的出自這本書的例句,也不要留一個空標題。
 */
export function findSentence(
	volumeId: string,
	word: string,
	volumeRoots: string[]
): string | null {
	for (const root of volumeRoots) {
		const epubPath = resolveEpubPath(volumeId, root);
		if (!epubPath) continue;
		for (const part of bookText(epubPath)) {
			const s = sentenceAround(part, word);
			if (s) return s;
		}
	}
	return null;
}
