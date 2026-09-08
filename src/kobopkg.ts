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
import { t } from "./i18n";

export interface KoboPkgOptions {
	host: string;
	port: number;
	token: string;
}

// 位址與密鑰放在一個獨立的設定檔,腳本開頭 source 它;插 USB 同步時外掛會把
// 電腦當下的 IP 寫回那個檔(見 devicecfg.ts)。**這是為了旅行**:IP 一換,燒死在
// 腳本裡的位址就連不到,而使用者看到的只是「按了沒反應」。
export const DEVICE_CONFIG_PATH = "/mnt/onboard/.adds/folio/config";

// 找得到設定檔就用它的位址,否則用產生安裝包當下燒進去的那組;逐一 probe /ping,
// 第一個回應的就是它。
function resolveSnippet(opts: KoboPkgOptions): string {
	return `
HOST_BAKED="${opts.host}"
PORT="${opts.port}"
TOKEN="${opts.token}"

# 設定檔由外掛在你插 USB 同步時自動更新(IP 換了不必重產安裝包)。
# PF_CONFIG 只是給測試換路徑用的,裝置上永遠走預設值。
CFG="\${PF_CONFIG:-${DEVICE_CONFIG_PATH}}"
[ -f "$CFG" ] && . "$CFG"
PORT="\${PORT:-${opts.port}}"
TOKEN="\${TOKEN:-${opts.token}}"

probe_once() {
  printf 'GET /ping HTTP/1.1\\r\\nHost: %s\\r\\nConnection: close\\r\\n\\r\\n' "$1" | nc -w 2 "$1" "$PORT" 2>/dev/null | grep -q "PaperFolio receiver OK"
}

# **nc 的 -w 不管「連不到的主機」**:位址還在路由表上但沒有人回應時(換了網路
# 之後最常見的就是這種),connect 會卡到系統預設逾時,一等就是一分鐘以上。
# 所以自己看門:超過秒數就把它砍掉,當成連不上。
probe() {
  # **背景工作的 stdout 一定要導掉。** 外層若用命令替換接結果,活著的 nc 會把
  # 那根管子撐開——subshell 被砍了,命令替換還在等管子關閉,整支腳本照樣卡死。
  probe_once "$1" >/dev/null 2>&1 &
  p=$!
  ( sleep 3; kill -9 $p 2>/dev/null ) >/dev/null 2>&1 &
  w=$!
  wait $p 2>/dev/null
  rc=$?
  kill $w 2>/dev/null
  return $rc
}

# 選中的位址放進 PICKED,不用 echo + $( ) —— 理由同上。
PICKED=""
pick_host() {
  for h in $HOSTS "$HOST_BAKED"; do
    [ -n "$h" ] || continue
    if probe "$h"; then PICKED="$h"; return 0; fi
  done
  return 1
}
`;
}

// 等 wlan0 真的拿到 IP。NickelMenu 的 :nickel_wifi :autoconnect 觸發連線後不保證
// 馬上有網路,實測沒等就送會得到「Network is unreachable」。
function waitWifi(secs: number): string {
	return `
i=0
while [ $i -lt ${secs} ]; do
  ip=$(busybox ifconfig 2>/dev/null | grep -A1 '^wlan0' | grep 'inet addr' | sed 's/.*inet addr://; s/ .*//')
  [ -n "$ip" ] && [ "$ip" != "0.0.0.0" ] && break
  sleep 1
  i=$((i+1))
done
`;
}

// nc 版推送腳本。核心手法:printf 組 HTTP header,cat 接資料庫本體,一起 pipe 進 nc。
function buildSyncScript(opts: KoboPkgOptions): string {
	return `#!/bin/sh
# PaperFolio -- 推送 Kobo 畫線資料庫到電腦(LAN, nc 版, 不需要 curl)。
# 由 Obsidian 外掛「產生 Kobo 安裝包」自動產生。
${resolveSnippet(opts)}
DB="/mnt/onboard/.kobo/KoboReader.sqlite"
${waitWifi(15)}
pick_host || exit 1
HOST="$PICKED"

cp "$DB" /tmp/pf-upload.sqlite || exit 1
SIZE=$(wc -c < /tmp/pf-upload.sqlite)

{ printf "POST /sync HTTP/1.1\\r\\nHost: %s:%s\\r\\nX-PaperFolio-Token: %s\\r\\nContent-Length: %s\\r\\nConnection: close\\r\\n\\r\\n" "$HOST" "$PORT" "$TOKEN" "$SIZE"; cat /tmp/pf-upload.sqlite; } | nc -w 60 "$HOST" "$PORT" > /dev/null 2>&1
RC=$?

rm -f /tmp/pf-upload.sqlite
exit $RC
`;
}

// 連線檢查。**失敗要看得見**——原本連不上時腳本安靜地退出,使用者只看到按鈕
// 沒反應,無從判斷是 WiFi 沒連、IP 換了、還是 Obsidian 沒開。這支給 cmd_output
// 用,所以要快:NickelMenu 的 cmd_output 上限是 10 秒。
function buildPreflightScript(opts: KoboPkgOptions): string {
	return `#!/bin/sh
# ${t("pf_comment")}
${resolveSnippet(opts)}${waitWifi(4)}
if [ -z "$ip" ] || [ "$ip" = "0.0.0.0" ]; then
  echo "${t("pf_no_wifi")}"
  exit 1
fi

pick_host || {
  echo "${t("pf_no_computer", { ip: "$ip" })}"
  echo ""
  echo "${t("pf_tried", { hosts: "$HOSTS $HOST_BAKED", port: "$PORT" })}"
  echo ""
  echo "${t("pf_hint")}"
  exit 1
}

echo "${t("pf_ok", { picked: "$PICKED", port: "$PORT" })}"
exit 0
`;
}

// NickelMenu 設定:同步照舊背景執行(cmd_spawn 不受 10 秒限制),但前面先跑一次
// 快速連線檢查,連不上就跳 toast 講原因,而不是安靜地什麼都不發生。另外加一顆
// 「檢查連線」,可以自己按來看完整診斷(cmd_output 會把輸出顯示成訊息框)。
// 選單標籤與提示都走 i18n。**這裡原本是硬寫的中文**,所以外掛設成英文時
// 機器上的選單仍然是中文(2026-09-08 道哥回報)——裝置端的字串跟 UI 字串一樣
// 要進字典,漏掉的那些不會有任何人提醒你。
// 兩條硬限制:NickelMenu 的 label 不能含半形冒號;整行會被寫進 sh 的 echo "..."
// 所以字串不能含半形雙引號。兩者都由 test/kobopkg-test.ts 驗。
function buildNmConfig(): string {
	const sync = t("nm_sync_label");
	const unreachable = t("nm_toast_unreachable");
	const syncing = t("nm_toast_syncing");
	// main 與 reader 兩處內容一模一樣,只差位置,所以共用同一個產生器。
	const entry = (loc: string) => `menu_item :${loc} :${sync} :nickel_wifi :autoconnect
  chain_success :cmd_output :quiet:8000:sh /mnt/onboard/.adds/folio/preflight.sh
  chain_failure :dbg_toast :${unreachable}
  chain_success :cmd_spawn :quiet:sh /mnt/onboard/.adds/folio/send-highlights.sh
  chain_success :dbg_toast :${syncing}`;

	return `# ${t("nm_header")}
${entry("main")}

menu_item :main :${t("nm_check_label")} :nickel_wifi :autoconnect
  chain_always :cmd_output :9000:sh /mnt/onboard/.adds/folio/preflight.sh

${entry("reader")}
`;
}

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
			content: enc.encode(buildNmConfig()),
		},
		{
			path: "mnt/onboard/.adds/folio/send-highlights.sh",
			content: enc.encode(buildSyncScript(opts)),
		},
		{
			path: "mnt/onboard/.adds/folio/preflight.sh",
			content: enc.encode(buildPreflightScript(opts)),
		},
	]);
	return gzipSync(tar, { level: 6 });
}
