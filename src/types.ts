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

export interface Book {
	volumeId: string;
	title: string;
	author: string;
	isbn: string;
	bookmarks: Bookmark[];
}
