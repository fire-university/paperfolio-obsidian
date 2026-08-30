// 資料結構：對應 Python 參考實作 reader.py 的 Bookmark / Book。

export interface Bookmark {
	bookmarkId: string;
	volumeId: string; // 書的 ContentID
	contentId: string; // 章節 ContentID
	type: string; // highlight | note | dogear
	text: string; // 畫線文字(dogear 為空)
	annotation: string; // 使用者手寫附註
	color: number | null;
	dateCreated: string;
	dateModified: string;
	containerPath: string; // StartContainerPath，精準排序用
	startOffset: number; // 排序 tiebreak
	chapterProgress: number; // 章節內進度 0..1(粗，勿單獨當排序鍵)
	chapterTitle: string; // 由 content 表 899 補齊
	chapterIndex: number; // 章節在書中的順序，排序用
}

// Kobo 內建字典查過的字(機身上的 My Words 開著才會存進 WordList)。
// 注意:WordList 只有單字與來源書，沒有原句——由此產生的生詞卡不會有上下文。
export interface KoboWord {
	text: string; // 查詢時長按的表面形(未還原原形，交給下游處理)
	book: string; // 來源書名,由 VolumeId 對 content.Title 得來
	dict: string; // DictSuffix，例如 -en-zh-TW
	date: string; // DateCreated
}

export interface Book {
	volumeId: string;
	title: string;
	author: string;
	isbn: string;
	bookmarks: Bookmark[];
}
