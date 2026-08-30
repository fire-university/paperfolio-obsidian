// 生詞交接檔的純邏輯:合併規則、檔案格式、路徑。
// 照 format.ts / writer.ts 的分工——這裡不碰 Obsidian API，所以 node 測試可直接跑;
// 真正寫檔在 writer.ts。
//
// 為什麼是 JSON 不是 Markdown:這是給機器讀的契約，不該混進使用者會手改的筆記。
// 使用者看得到的產物是生詞本本身,不是這份中間清單(檔名以 . 開頭,不出現在檔案總管)。
//
// 只增不減:Kobo 上把字從 My Words 移除，不會回頭刪這裡——那些字多半已經進了生詞本,
// 清掉只會讓下游以為使用者要退卡。

import type { KoboWord } from "./types";
import type { PaperFolioSettings } from "./settings";

export const WORDLIST_FILENAME = ".kobo-words.json";
/**
 * 交接檔有新字時,在 workspace 上發這個事件。
 *
 * 生詞本外掛(WordFolio)聽到就能直接匯入,使用者不必在 Kobo 按完同步之後
 * 再回 Obsidian 按一次匯入——**Kobo 機身上那顆按鈕因此一路到底**。
 * Obsidian 沒有官方的跨外掛事件匯流排,但 workspace 本身就是一個 Events,
 * 兩邊約好同一個字串就能通;沒人在聽也不會有任何影響。
 */
export const WORDS_SYNCED_EVENT = "paperfolio:words-synced";
export const WORDLIST_VERSION = 1;

export interface WordListFile {
	version: number;
	updated: string;
	words: KoboWord[];
}

export interface WordListResult {
	total: number; // 檔案裡目前共幾個字
	added: number; // 這次新增幾個
}

export function wordListPath(settings: PaperFolioSettings): string {
	const set = settings.wordListPath.trim();
	const p = set || `${settings.outputFolder}/${WORDLIST_FILENAME}`;
	return p.replace(/\/{2,}/g, "/").replace(/^\/+|\/+$/g, "");
}

function byDate(a: KoboWord, b: KoboWord): number {
	if (a.date !== b.date) return a.date < b.date ? -1 : 1;
	return a.text.localeCompare(b.text);
}

// 以字為鍵合併(不分大小寫)。同一個字在兩本書查過就保留最早那次——
// 「第一次是在哪本書遇到的」比「最後一次」有意義。
export function mergeWords(
	existing: KoboWord[],
	incoming: KoboWord[]
): KoboWord[] {
	const byWord = new Map<string, KoboWord>();
	for (const w of [...existing, ...incoming]) {
		const key = w.text.trim().toLowerCase();
		if (!key) continue;
		const prev = byWord.get(key);
		if (!prev || (w.date && (!prev.date || w.date < prev.date))) {
			byWord.set(key, w);
		}
	}
	return [...byWord.values()].sort(byDate);
}

export function parseWordListFile(text: string): KoboWord[] {
	try {
		const data = JSON.parse(text) as Partial<WordListFile>;
		if (!data || !Array.isArray(data.words)) return [];
		return data.words.filter(
			(w): w is KoboWord => !!w && typeof w.text === "string"
		);
	} catch (e) {
		// 檔壞了不當致命傷:字都還在 Kobo 上,下一次同步會重建。
		console.warn("PaperFolio: .kobo-words.json unreadable, rebuilding", e);
		return [];
	}
}

export function buildWordListContent(words: KoboWord[], now: Date): string {
	const file: WordListFile = {
		version: WORDLIST_VERSION,
		updated: now.toISOString(),
		words,
	};
	return JSON.stringify(file, null, "\t") + "\n";
}
