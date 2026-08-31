// 把電腦當下的區網位址寫回 Kobo,讓無線同步在換網路之後自己活過來。
//
// 為什麼需要:安裝包產生時會把 IP 燒進腳本,而 IP 是會變的——換一個地方、
// 換一次 WiFi、DHCP 重新配發都會變。旅行時幾乎每天都在變。使用者看到的
// 症狀是「按了沒反應」,而正確的動作(回 Obsidian 重產安裝包、丟進 Kobo、
// 安全退出)沒有人猜得到。
//
// 插 USB 同步時,電腦與裝置本來就在同一台機器上,這時把當下的 IP 寫進裝置上
// 我們自己的資料夾,腳本下次就會先試那些位址。**只寫我們自己的資料夾**,
// 而且只在那個資料夾已經存在時才寫(＝安裝包裝過);沒裝過就什麼都不做。

import * as fs from "fs";
import * as path from "path";

/** 裝置上放設定的資料夾(相對於掛載卷根目錄)。 */
export const DEVICE_FOLIO_DIR = ".adds/folio";
export const DEVICE_CONFIG_FILE = "config";

export interface DeviceConfig {
	hosts: string[];
	port: number;
	token: string;
}

/**
 * 設定檔內容。這是給 `/bin/sh` 用 `.` source 的,所以值一律用雙引號包起來,
 * 並把引號與反斜線跳脫掉——IP 與埠不可能有奇怪字元,但密鑰是產生出來的,
 * 不該假設它永遠乾淨。
 */
export function deviceConfigContent(cfg: DeviceConfig, now: Date): string {
	const q = (v: string) => `"${v.replace(/[\\"$`]/g, "\\$&")}"`;
	return [
		"# PaperFolio -- 由 Obsidian 外掛在你插 USB 同步時自動更新,不用手改。",
		`# 更新時間:${now.toISOString()}`,
		`HOSTS=${q(cfg.hosts.join(" "))}`,
		`PORT=${q(String(cfg.port))}`,
		`TOKEN=${q(cfg.token)}`,
		"",
	].join("\n");
}

/**
 * 寫回裝置。回傳有沒有真的寫(資料夾不存在＝沒裝過安裝包,回 false)。
 *
 * 內容沒變就不重寫:裝置是 FAT32 的隨身碟,每次同步都動檔案沒有意義。
 */
export function updateDeviceConfig(
	volumeRoot: string,
	cfg: DeviceConfig,
	now = new Date()
): boolean {
	const dir = path.join(volumeRoot, DEVICE_FOLIO_DIR);
	if (!fs.existsSync(dir)) return false;

	const file = path.join(dir, DEVICE_CONFIG_FILE);
	const next = deviceConfigContent(cfg, now);
	try {
		if (fs.existsSync(file)) {
			const cur = fs.readFileSync(file, "utf-8");
			// 只比對真正有意義的那幾行,時間戳不算。
			const strip = (s: string) =>
				s.split("\n").filter((l) => !l.startsWith("#")).join("\n");
			if (strip(cur) === strip(next)) return true;
		}
		fs.writeFileSync(file, next, "utf-8");
		return true;
	} catch (e) {
		// 裝置唯讀、拔線拔到一半:同步本身不該因此失敗。
		console.warn("PaperFolio: could not update the address on the Kobo", e);
		return false;
	}
}
