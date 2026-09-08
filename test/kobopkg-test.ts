// 驗證 buildKoboRootTgz 產出的 tar+gzip 是不是真的合法:寫檔、用系統 tar 解壓、比對內容。
// Kobo 韌體本身就是用 tar 解 KoboRoot.tgz,能被標準 tar 正確解開是最低限度的正確性保證。
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execFileSync } from "child_process";
import { buildKoboRootTgz } from "../src/kobopkg";
import { setLang, t } from "../src/i18n";

function main() {
	const bytes = buildKoboRootTgz({
		host: "172.26.188.48",
		port: 8322,
		token: "test-token-abc",
	});

	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pf-kobopkg-"));
	const tgzPath = path.join(tmp, "KoboRoot.tgz");
	fs.writeFileSync(tgzPath, bytes);
	console.error(`[產出] ${tgzPath}(${bytes.length} bytes)`);

	execFileSync("tar", ["-xzf", tgzPath, "-C", tmp]);

	const nm = path.join(tmp, "mnt/onboard/.adds/nm/paperfolio");
	const sh = path.join(tmp, "mnt/onboard/.adds/folio/send-highlights.sh");

	const pre = path.join(tmp, "mnt/onboard/.adds/folio/preflight.sh");
	if (!fs.existsSync(nm)) throw new Error("nm 設定沒解出來");
	if (!fs.existsSync(sh)) throw new Error("send-highlights.sh 沒解出來");
	if (!fs.existsSync(pre)) throw new Error("preflight.sh 沒解出來");

	const shContent = fs.readFileSync(sh, "utf-8");
	// 燒進去的位址是**退路**:設定檔(插 USB 時外掛會更新)優先。
	if (!shContent.includes('HOST_BAKED="172.26.188.48"')) throw new Error("HOST 沒填進去");
	if (!shContent.includes('PORT="8322"')) throw new Error("PORT 沒填進去");
	if (!shContent.includes('TOKEN="test-token-abc"')) throw new Error("TOKEN 沒填進去");
	if (!shContent.includes("nc -w")) throw new Error("缺 nc 呼叫");
	if (!shContent.includes("/mnt/onboard/.adds/folio/config")) {
		throw new Error("沒有讀設定檔,IP 換了就會連不上");
	}

	const nmContent = fs.readFileSync(nm, "utf-8");
	if (!nmContent.includes("send-highlights.sh")) throw new Error("nm 設定沒指到腳本");
	if (!nmContent.includes("preflight.sh")) throw new Error("nm 設定沒接上連線檢查");
	if (!nmContent.includes("chain_failure")) throw new Error("連不上時沒有任何提示");

	console.error("[通過] 系統 tar 能正確解開,內容與檔名都對");
	fs.rmSync(tmp, { recursive: true, force: true });
}

// 裝置端字串跟著外掛語言走,而且不能違反兩條硬限制。
//
// 2026-09-08:選單標籤原本是硬寫的中文,外掛設成英文時機器上仍然是中文——
// 而**這種漏字串不會有任何人提醒你**,它只是安靜地用錯語言。所以這裡逐語言
// 產一次包、把檔案讀出來比對,不是只看程式碼有沒有呼叫 t()。
function langChecks() {
	let bad = 0;
	const fail = (m: string) => {
		console.error("  ✗ " + m);
		bad++;
	};

	for (const lang of ["en", "zh-TW"] as const) {
		setLang(lang);
		const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pf-lang-"));
		const tgz = path.join(tmp, "KoboRoot.tgz");
		fs.writeFileSync(tgz, buildKoboRootTgz({ host: "10.0.0.9", port: 8322, token: "tok" }));
		execFileSync("tar", ["-xzf", tgz, "-C", tmp]);
		const nm = fs.readFileSync(path.join(tmp, "mnt/onboard/.adds/nm/paperfolio"), "utf-8");
		const pre = fs.readFileSync(path.join(tmp, "mnt/onboard/.adds/folio/preflight.sh"), "utf-8");

		// (1) 真的換了語言
		if (!nm.includes(t("nm_sync_label"))) fail(`${lang}:選單標籤沒跟著語言換`);
		if (!pre.includes(t("pf_no_wifi"))) fail(`${lang}:preflight 訊息沒跟著語言換`);

		// (2) NickelMenu 的 label 不能含半形冒號,含了整行會被切錯欄位
		for (const line of nm.split("\n")) {
			if (!line.startsWith("menu_item ")) continue;
			const label = line.split(":")[2] ?? "";
			if (label.trim() !== label.trim().replace(/:/g, "")) {
				fail(`${lang}:選單標籤含半形冒號 -> ${label}`);
			}
			// menu_item 應該正好是 location/label/action/arg 四段
			if (line.split(":").length !== 5) fail(`${lang}:menu_item 欄位數不對 -> ${line}`);
		}

		// (3) 這些字串會被塞進 sh 的 echo "...",半形雙引號會把字串截斷
		for (const k of ["pf_no_wifi", "pf_no_computer", "pf_tried", "pf_hint", "pf_ok"]) {
			if (t(k).includes('"')) fail(`${lang}:${k} 含半形雙引號,會弄壞 echo`);
		}

		// (4) shell 變數要原樣留著。interpolate 用 String.replace,而 replace 的
		//     取代字串裡 $ 有特殊語意——$ip 這種目前安全,但值得釘住。
		for (const v of ["$ip", "$PORT", "$PICKED", "$HOSTS"]) {
			if (!pre.includes(v)) fail(`${lang}:preflight 少了 shell 變數 ${v}`);
		}

		// (5) preflight 產出來的還是合法的 sh
		try {
			execFileSync("sh", ["-n", path.join(tmp, "mnt/onboard/.adds/folio/preflight.sh")]);
		} catch {
			fail(`${lang}:preflight.sh 過不了 sh -n`);
		}

		fs.rmSync(tmp, { recursive: true, force: true });
		console.error(`  ✓ ${lang}:選單「${t("nm_sync_label")}」`);
	}

	if (bad) {
		console.error(`[失敗] 語言檢查 ${bad} 項`);
		process.exit(1);
	}
	console.error("[通過] 兩種語言都正確,且沒有違反冒號／雙引號限制");
}

main();
langChecks();
