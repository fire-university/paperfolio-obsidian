// 產生 Kobo 端一鍵安裝包(KoboRoot.tgz)。
//
// 背景:LAN 無線同步原本要使用者自備靜態 ARM curl + 手動編輯腳本填 IP/密鑰,
// 是非工程師最容易卡住的一步。實機測試(2026-07-22,韌體 4.9.77/armv7l)證實
// busybox 內建的 nc 可以手工組 HTTP POST 完整送出整個 KoboReader.sqlite,
// 拿掉 curl 依賴後就不再有機型二進位相容性問題,腳本可以直接由外掛動態產生、
// 把當下的 IP 與密鑰直接嵌入,使用者只需把產生的檔案丟進 Kobo 的 .kobo/ 資料夾、
// 安全退出即可自動安裝(Kobo 韌體看到 .kobo/ 底下的 KoboRoot.tgz 會自動解壓到根目錄)。
//
// NickelMenu 本身不在這個包裡(GPL,需另外安裝一次)。

import { gzipSync } from "fflate";

export interface KoboPkgOptions {
	host: string;
	port: number;
	token: string;
}

// nc 版推送腳本。核心手法:printf 組 HTTP header,cat 接資料庫本體,一起 pipe 進 nc。
// 先等 wlan0 真的拿到 IP 再送出:NickelMenu 的 :nickel_wifi :autoconnect 觸發連線後
// 不保證馬上有網路,實測沒等就送會得到「Network is unreachable」。
function buildSyncScript(opts: KoboPkgOptions): string {
	return `#!/bin/sh
# PaperFolio -- 推送 Kobo 畫線資料庫到 Mac(LAN, nc 版, 不需要 curl)。
# 由 Obsidian 外掛「產生 Kobo 安裝包」自動產生,已內嵌你的同步位址與密鑰。

DB="/mnt/onboard/.kobo/KoboReader.sqlite"
HOST="${opts.host}"
PORT="${opts.port}"
TOKEN="${opts.token}"

# 等 WiFi 真的連上拿到 IP,最多 15 秒
i=0
while [ $i -lt 15 ]; do
  ip=$(busybox ifconfig 2>/dev/null | grep -A1 '^wlan0' | grep 'inet addr' | sed 's/.*inet addr://; s/ .*//')
  [ -n "$ip" ] && [ "$ip" != "0.0.0.0" ] && break
  sleep 1
  i=$((i+1))
done

cp "$DB" /tmp/pf-upload.sqlite || exit 1
SIZE=$(wc -c < /tmp/pf-upload.sqlite)

{ printf "POST /sync HTTP/1.1\\r\\nHost: %s:%s\\r\\nX-PaperFolio-Token: %s\\r\\nContent-Length: %s\\r\\nConnection: close\\r\\n\\r\\n" "$HOST" "$PORT" "$TOKEN" "$SIZE"; cat /tmp/pf-upload.sqlite; } | nc -w 20 "$HOST" "$PORT" > /dev/null 2>&1
RC=$?

rm -f /tmp/pf-upload.sqlite
exit $RC
`;
}

// NickelMenu 設定:主畫面與閱讀中都加一顆按鈕,背景執行(cmd_spawn,不受 10 秒限制)。
const NM_CONFIG = `# NickelMenu 設定 -- PaperFolio(由外掛自動產生)
menu_item :main :PaperFolio 同步畫線 :nickel_wifi :autoconnect
  chain_success :cmd_spawn :quiet:sh /mnt/onboard/.adds/folio/send-highlights.sh
  chain_success :dbg_toast :同步中，稍候看電腦通知

menu_item :reader :PaperFolio 同步畫線 :nickel_wifi :autoconnect
  chain_success :cmd_spawn :quiet:sh /mnt/onboard/.adds/folio/send-highlights.sh
  chain_success :dbg_toast :同步中，稍候看電腦通知
`;

function tarHeader(name: string, size: number): Uint8Array {
	const buf = new Uint8Array(512);
	const enc = new TextEncoder();
	const writeStr = (offset: number, str: string, len: number) => {
		buf.set(enc.encode(str).subarray(0, len), offset);
	};
	const writeOctal = (offset: number, value: number, len: number) => {
		writeStr(offset, value.toString(8).padStart(len - 1, "0") + "\0", len);
	};

	writeStr(0, name, 100); // name
	writeOctal(100, 0o755, 8); // mode
	writeOctal(108, 0, 8); // uid
	writeOctal(116, 0, 8); // gid
	writeOctal(124, size, 12); // size
	writeOctal(136, Math.floor(Date.now() / 1000), 12); // mtime
	writeStr(148, "        ", 8); // chksum placeholder(8 空白)
	buf[156] = "0".charCodeAt(0); // typeflag:一般檔案
	writeStr(257, "ustar", 6); // magic
	writeStr(263, "00", 2); // version

	let sum = 0;
	for (let i = 0; i < 512; i++) sum += buf[i];
	writeStr(148, sum.toString(8).padStart(6, "0") + "\0 ", 8);
	return buf;
}

function pad512(len: number): number {
	return (512 - (len % 512)) % 512;
}

export function buildTar(files: { path: string; content: Uint8Array }[]): Uint8Array {
	const parts: Uint8Array[] = [];
	for (const f of files) {
		parts.push(tarHeader(f.path, f.content.length), f.content);
		const pad = pad512(f.content.length);
		if (pad) parts.push(new Uint8Array(pad));
	}
	parts.push(new Uint8Array(512), new Uint8Array(512)); // 結尾兩個全零區塊
	const total = parts.reduce((a, p) => a + p.length, 0);
	const out = new Uint8Array(total);
	let off = 0;
	for (const p of parts) {
		out.set(p, off);
		off += p.length;
	}
	return out;
}

// KoboRoot.tgz 的路徑要相對於 Kobo 根目錄(/),onboard 分割區掛在 /mnt/onboard,
// 所以放到 .adds/ 底下的檔案路徑要寫成 mnt/onboard/.adds/...。
export function buildKoboRootTgz(opts: KoboPkgOptions): Uint8Array {
	const enc = new TextEncoder();
	const tar = buildTar([
		{
			path: "mnt/onboard/.adds/nm/paperfolio",
			content: enc.encode(NM_CONFIG),
		},
		{
			path: "mnt/onboard/.adds/folio/send-highlights.sh",
			content: enc.encode(buildSyncScript(opts)),
		},
	]);
	return gzipSync(tar, { level: 6 });
}
