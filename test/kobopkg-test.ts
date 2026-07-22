// 驗證 buildKoboRootTgz 產出的 tar+gzip 是不是真的合法:寫檔、用系統 tar 解壓、比對內容。
// Kobo 韌體本身就是用 tar 解 KoboRoot.tgz,能被標準 tar 正確解開是最低限度的正確性保證。
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execFileSync } from "child_process";
import { buildKoboRootTgz } from "../src/kobopkg";

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

	if (!fs.existsSync(nm)) throw new Error("nm 設定沒解出來");
	if (!fs.existsSync(sh)) throw new Error("send-highlights.sh 沒解出來");

	const shContent = fs.readFileSync(sh, "utf-8");
	if (!shContent.includes('HOST="172.26.188.48"')) throw new Error("HOST 沒填進去");
	if (!shContent.includes('PORT="8322"')) throw new Error("PORT 沒填進去");
	if (!shContent.includes('TOKEN="test-token-abc"')) throw new Error("TOKEN 沒填進去");
	if (!shContent.includes("nc -w 20")) throw new Error("缺 nc 呼叫");

	const nmContent = fs.readFileSync(nm, "utf-8");
	if (!nmContent.includes("send-highlights.sh")) throw new Error("nm 設定沒指到腳本");

	console.error("[通過] 系統 tar 能正確解開,內容與檔名都對");
	fs.rmSync(tmp, { recursive: true, force: true });
}

main();
