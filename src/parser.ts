// 讀取層：用 sql.js(WASM) 唯讀解析 KoboReader.sqlite 的位元組快照。
// 移植自 Python 參考實作 reader.py。設計重點:
// - 只吃記憶體裡的位元組(呼叫端已 fs.readFileSync 成快照)，永不寫回裝置。
// - 章節名來自 content 表 ContentType=899(真章節名，無線模式也拿得到)。
// - 排序絕不用畫線時間，改用 (章節順序, koboSpan N, koboSpan M, StartOffset, 進度)。

import initSqlJs from "sql.js";
import type { Database, SqlJsStatic, QueryExecResult } from "sql.js";
// esbuild 以 binary loader 內嵌 sql.js 的 wasm(見 esbuild.config.mjs / wasm.d.ts)。
import wasmBinary from "sql.js/dist/sql-wasm.wasm";
import type { Book, Bookmark } from "./types";

// kepub 的 StartContainerPath 形如 span#kobo\.14\.1；N=段落序號、M=段落內序號，越大越後面。
const KOBO_SPAN = /kobo\D*(\d+)\D+(\d+)/;
const BIG = 1_000_000_000;
const CHAPTER_FALLBACK_INDEX = 10_000;

let sqlPromise: Promise<SqlJsStatic> | null = null;

function getSql(): Promise<SqlJsStatic> {
	if (!sqlPromise) {
		sqlPromise = initSqlJs({
			wasmBinary: wasmBinary as unknown as ArrayBuffer,
		});
	}
	return sqlPromise;
}

function spanKey(containerPath: string): [number, number] {
	const m = KOBO_SPAN.exec((containerPath || "").replace(/\\/g, ""));
	return m ? [parseInt(m[1], 10), parseInt(m[2], 10)] : [BIG, BIG];
}

// 書內閱讀順序:章節順序 → 章節內精準位置(koboSpan) → StartOffset → 進度。
export function bookmarkSortKey(b: Bookmark): number[] {
	const [n, m] = spanKey(b.containerPath);
	return [b.chapterIndex, n, m, b.startOffset, b.chapterProgress];
}

function compareKeys(a: number[], b: number[]): number {
	for (let i = 0; i < a.length; i++) {
		if (a[i] < b[i]) return -1;
		if (a[i] > b[i]) return 1;
	}
	return 0;
}

export function sortBookmarks(bookmarks: Bookmark[]): void {
	bookmarks.sort((x, y) => compareKeys(bookmarkSortKey(x), bookmarkSortKey(y)));
}

// --- sql.js 小工具:把 exec 結果攤成物件陣列 ---

function rowsOf(res: QueryExecResult[]): Record<string, unknown>[] {
	if (!res.length) return [];
	const { columns, values } = res[0];
	return values.map((v) => {
		const o: Record<string, unknown> = {};
		columns.forEach((c, i) => (o[c] = v[i]));
		return o;
	});
}

function tableColumns(db: Database, table: string): Set<string> {
	const res = db.exec(`PRAGMA table_info(${table})`);
	const cols = new Set<string>();
	if (res.length) {
		const nameIdx = res[0].columns.indexOf("name");
		for (const row of res[0].values) cols.add(String(row[nameIdx]));
	}
	return cols;
}

function str(v: unknown): string {
	return v === null || v === undefined ? "" : String(v);
}

function num(v: unknown, dflt = 0): number {
	if (v === null || v === undefined || v === "") return dflt;
	const n = Number(v);
	return Number.isFinite(n) ? n : dflt;
}

// --- 主流程 ---

export async function readBookmarks(dbBytes: Uint8Array): Promise<Book[]> {
	const SQL = await getSql();
	const db = new SQL.Database(dbBytes);
	try {
		return readInternal(db);
	} finally {
		db.close();
	}
}

function readInternal(db: Database): Book[] {
	const bmCols = tableColumns(db, "Bookmark");
	const colorSel = bmCols.has("Color") ? "Color" : "NULL AS Color";
	const modifiedSel = bmCols.has("DateModified")
		? "DateModified"
		: "NULL AS DateModified";

	const bookmarkRows = rowsOf(
		db.exec(
			`SELECT BookmarkID, VolumeID, ContentID, Type,
			        Text, Annotation, ${colorSel},
			        DateCreated, ${modifiedSel},
			        StartContainerPath, StartOffset, ChapterProgress
			 FROM Bookmark
			 WHERE Type IN ('highlight', 'note', 'dogear')`
		)
	);

	// 章節資訊:ContentType=899(目錄列，帶真章節名＋章節順序 VolumeIndex)。
	// 這些列的 ContentID 結尾有 -N 錨點，去掉後就等於 bookmark 的 ContentID(章節檔)。
	const chapterInfo = new Map<string, { title: string; index: number }>();
	for (const c of rowsOf(
		db.exec(
			`SELECT ContentID, Title, VolumeIndex FROM content
			 WHERE ContentType=899 AND Title IS NOT NULL`
		)
	)) {
		const base = str(c.ContentID).replace(/-\d+$/, "");
		const idx =
			c.VolumeIndex === null || c.VolumeIndex === undefined
				? CHAPTER_FALLBACK_INDEX
				: num(c.VolumeIndex, CHAPTER_FALLBACK_INDEX);
		if (!chapterInfo.has(base)) {
			chapterInfo.set(base, { title: str(c.Title), index: idx });
		}
	}

	// 書層 metadata:優先抓 ContentType=6(書)，這裡用「ContentID = 任一 VolumeID」撈。
	const bookMeta = new Map<
		string,
		{ title: string; author: string; isbn: string }
	>();
	for (const c of rowsOf(
		db.exec(
			`SELECT ContentID, Title, Attribution, ISBN FROM content
			 WHERE ContentID IN (SELECT DISTINCT VolumeID FROM Bookmark)`
		)
	)) {
		bookMeta.set(str(c.ContentID), {
			title: str(c.Title),
			author: str(c.Attribution),
			isbn: str(c.ISBN),
		});
	}

	const books = new Map<string, Book>();
	for (const r of bookmarkRows) {
		const vid = str(r.VolumeID);
		if (!books.has(vid)) {
			const meta = bookMeta.get(vid);
			const title = meta && meta.title ? meta.title : fallbackTitle(vid);
			books.set(vid, {
				volumeId: vid,
				title,
				author: meta ? meta.author : "",
				isbn: meta ? meta.isbn : "",
				bookmarks: [],
			});
		}

		const ch = chapterInfo.get(str(r.ContentID));
		books.get(vid)!.bookmarks.push({
			bookmarkId: str(r.BookmarkID),
			volumeId: vid,
			contentId: str(r.ContentID),
			type: str(r.Type),
			text: str(r.Text).trim(),
			annotation: str(r.Annotation).trim(),
			color: r.Color === null || r.Color === undefined ? null : num(r.Color),
			dateCreated: str(r.DateCreated),
			dateModified: str(r.DateModified),
			containerPath: str(r.StartContainerPath),
			startOffset: num(r.StartOffset),
			chapterProgress: num(r.ChapterProgress),
			chapterTitle: ch ? ch.title : "",
			chapterIndex: ch ? ch.index : CHAPTER_FALLBACK_INDEX,
		});
	}

	// 每本書內:依「書內閱讀位置」精準排序(章節→koboSpan→offset)，不靠畫線時間。
	const list = Array.from(books.values());
	for (const book of list) sortBookmarks(book.bookmarks);
	return list;
}

// VolumeID 撈不到書名時，用檔名當標題。
function fallbackTitle(volumeId: string): string {
	let name = volumeId.split("/").pop() || volumeId;
	for (const suffix of [".kepub.epub", ".epub", ".kepub"]) {
		if (name.endsWith(suffix)) {
			name = name.slice(0, -suffix.length);
			break;
		}
	}
	return name || "未命名書籍";
}
