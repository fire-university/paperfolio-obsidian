// 驗證產生出來的 Kobo 腳本:語法過得了 sh、而且連線判斷真的會動。
//
// 為什麼要做到「真的跑一次」:這兩支腳本跑在 Kobo 上,寫錯了這邊完全看不到——
// 使用者拿到的是一顆按了沒反應的按鈕(2026-08-31 就是這樣浪費了半天在找原因)。
// 這裡用假的 busybox 餵一個 wlan0 位址,再對真的 HTTP 伺服器 probe。
//
//   npx tsx test/device-script-check.ts

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as http from "http";
import { execFileSync as run, spawn } from "child_process";
import { buildKoboRootTgz } from "../src/kobopkg";
import { deviceConfigContent } from "../src/devicecfg";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
	console.log(`${ok ? "  ✓" : "  ✗"} ${label}${detail ? "  " + detail : ""}`);
	if (!ok) failures++;
}

function extract(tmp: string): void {
	const bytes = buildKoboRootTgz({ host: "10.1.2.3", port: 8322, token: "tok-123" });
	fs.writeFileSync(path.join(tmp, "KoboRoot.tgz"), bytes);
	run("tar", ["-xzf", path.join(tmp, "KoboRoot.tgz"), "-C", tmp]);
}

async function main() {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pf-dev-"));
	extract(tmp);
	const folio = path.join(tmp, "mnt/onboard/.adds/folio");
	const preflight = path.join(folio, "preflight.sh");
	const send = path.join(folio, "send-highlights.sh");

	console.log("語法");
	for (const f of [preflight, send]) {
		try {
			run("sh", ["-n", f]);
			check(`${path.basename(f)} 過得了 sh -n`, true);
		} catch (e) {
			check(`${path.basename(f)} 過得了 sh -n`, false, String(e));
		}
	}

	// 假的 busybox:讓腳本以為 wlan0 已經拿到位址(macOS 上沒有 wlan0)。
	const bin = path.join(tmp, "bin");
	fs.mkdirSync(bin);
	fs.writeFileSync(
		path.join(bin, "busybox"),
		'#!/bin/sh\necho "wlan0     Link encap:Ethernet"\necho "          inet addr:192.168.1.5  Bcast:192.168.1.255"\n'
	);
	fs.chmodSync(path.join(bin, "busybox"), 0o755);
	const env = {
		...process.env,
		PATH: `${bin}:${process.env.PATH}`,
		PF_CONFIG: path.join(folio, "config"), // 裝置上是絕對路徑,測試改指到這裡
	};

	// 真的起一個假的接收端,回應跟 PaperFolio 的 /ping 一樣。
	// 假的接收端**必須跑在另一個行程**:底下用 execFileSync 跑腳本會把這個
	// 行程的事件迴圈整個擋住,同一個行程裡的 server 根本來不及回應
	// (第一版就是這樣,結果一直以為是腳本連不上)。
	// 回應也要跟真的接收端一樣帶 Content-Length:Node 預設走 chunked,
	// body 會被切成帶長度前綴的區塊,跟裝置上實際收到的不一樣。
	const stub = spawn(
		process.execPath,
		[
			"-e",
			`const http=require("http");const b="PaperFolio receiver OK";` +
				`const s=http.createServer((q,r)=>{r.writeHead(200,{"Content-Length":Buffer.byteLength(b)});r.end(b)});` +
				`s.listen(0,"127.0.0.1",()=>console.log(s.address().port));`,
		],
		{ stdio: ["ignore", "pipe", "inherit"] }
	);
	const port = await new Promise<number>((res) => {
		stub.stdout.on("data", (d: Buffer) => res(parseInt(d.toString().trim(), 10)));
	});

	// 借一個埠、馬上關掉:拿來當「連線被拒」的對象(立刻回來,不用等逾時)。
	const dead = http.createServer();
	await new Promise<void>((r) => dead.listen(0, "127.0.0.1", () => r()));
	const closedPort = (dead.address() as { port: number }).port;
	await new Promise<void>((r) => dead.close(() => r()));

	const writeConfig = (hosts: string) =>
		fs.writeFileSync(
			path.join(folio, "config"),
			deviceConfigContent({ hosts: hosts.split(" "), port, token: "tok-123" }, new Date())
		);

	console.log("\n連得上的時候");
	writeConfig("127.0.0.1");
	try {
		const out = run("sh", [preflight], { env, encoding: "utf-8" });
		check("退出碼 0", true);
		check("有講找到哪一台", out.includes("找得到電腦 127.0.0.1"), out.trim());
	} catch (e) {
		check("退出碼 0", false, String((e as { stdout?: string }).stdout ?? e));
	}

	console.log("\n連不上的時候");
	// 用本機一個沒人聽的埠:連線被拒是立刻回來的。
	// (不要用 TEST-NET 那種不可路由的位址——那會等到逾時,測試就變成龜速。)
	writeConfig("127.0.0.1");
	fs.writeFileSync(
		path.join(folio, "config"),
		deviceConfigContent({ hosts: ["127.0.0.1"], port: closedPort, token: "tok-123" }, new Date())
	);
	try {
		run("sh", [preflight], { env, encoding: "utf-8" });
		check("要以非 0 退出", false, "居然成功了");
	} catch (e) {
		const out = String((e as { stdout?: string }).stdout ?? "");
		check("以非 0 退出", true);
		check("有講是找不到電腦而不是 WiFi", out.includes("找不到電腦"), out.trim().split("\n")[0]);
		check("有把試過的位址列出來", out.includes("127.0.0.1") && out.includes("10.1.2.3"));
		check("有給下一步", out.includes("產生 Kobo 安裝包"));
	}

	console.log("\n設定檔");
	const cfg = deviceConfigContent({ hosts: ["1.2.3.4", "5.6.7.8"], port: 8322, token: 'a"b$c' }, new Date());
	check("HOSTS 是空白分隔的一行", cfg.includes('HOSTS="1.2.3.4 5.6.7.8"'), cfg.split("\n")[2]);
	check("密鑰裡的引號與 $ 有跳脫", cfg.includes('TOKEN="a\\"b\\$c"'), cfg.split("\n")[4]);
	fs.writeFileSync(path.join(tmp, "c.sh"), cfg + '\necho "$HOSTS|$PORT|$TOKEN"\n');
	const sourced = run("sh", [path.join(tmp, "c.sh")], { encoding: "utf-8" }).trim();
	check("sh source 回來的值原封不動", sourced === '1.2.3.4 5.6.7.8|8322|a"b$c', sourced);

	// 腳本沒有設定檔時要退回燒進去的位址,不能整支壞掉。
	console.log("\n沒有設定檔的時候");
	fs.rmSync(path.join(folio, "config"));
	try {
		run("sh", [preflight], { env, encoding: "utf-8" });
		check("退回燒進去的位址(10.1.2.3 連不上,所以應該失敗)", false, "居然成功了");
	} catch (e) {
		const out = String((e as { stdout?: string }).stdout ?? "");
		check("仍然跑得完並回報", out.includes("10.1.2.3"), out.trim().split("\n")[2] ?? out);
	}

	stub.kill();
	fs.rmSync(tmp, { recursive: true, force: true });
	console.log(failures ? `\n${failures} 項失敗` : "\n全部通過");
	process.exit(failures ? 1 : 0);
}

void main();
