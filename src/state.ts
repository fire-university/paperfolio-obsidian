// 增量／去重層:記錄已匯入的 bookmark 指紋，重插只算新增／變更。
// 移植自 Python incremental.py;Python 存 ~/.kobosync/state.json，
// 外掛改存進外掛自己的 data.json(見 main.ts)。

import { createHash } from "crypto";
import type { Bookmark } from "./types";

export type StateData = Record<string, string>; // { bookmarkId: fingerprint }

function fingerprint(b: Bookmark): string {
	const raw = `${b.text}\x1f${b.annotation}\x1f${b.dateModified}`;
	return createHash("sha1").update(raw, "utf8").digest("hex");
}

export class State {
	// 直接持有呼叫端傳入的物件參考;mark() 就地更新，之後由 main 存回 data.json。
	constructor(private data: StateData) {}

	isNewOrChanged(b: Bookmark): boolean {
		return this.data[b.bookmarkId] !== fingerprint(b);
	}

	mark(b: Bookmark): void {
		this.data[b.bookmarkId] = fingerprint(b);
	}

	export(): StateData {
		return this.data;
	}
}
