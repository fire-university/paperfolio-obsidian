// 無線接收端(LAN):Obsidian 開著時聽一個埠，Kobo 一鍵把 KoboReader.sqlite 推上來。
// 移植自 Python receiver.py，改用 Node http。純 Node、無 Obsidian 依賴，可離線測。
//
// 與 Python 版的關鍵差異:綁 0.0.0.0(不是 127.0.0.1)，讓同 LAN 的 Kobo 連得到;
// 靠共享密鑰(header X-PaperFolio-Token)擋未授權。Kobo 端:
//   curl -f -H "X-PaperFolio-Token: <token>" --data-binary @KoboReader.sqlite \
//        http://<Mac LAN IP>:<port>/sync

import * as http from "http";

const DEFAULT_MAX_BYTES = 200 * 1024 * 1024; // DB 上限 200MB，擋爆量
export const TOKEN_HEADER = "x-paperfolio-token"; // Node 會把 header 轉小寫

export interface ReceiverOptions {
	port: number;
	token: string;
	// 收到 DB → 交給呼叫端跑引擎，回一段摘要字串(回給 Kobo 顯示)
	onSync: (bytes: Uint8Array) => Promise<string>;
	onError?: (err: Error) => void;
	maxBytes?: number;
}

export class Receiver {
	private server: http.Server | null = null;

	constructor(private opts: ReceiverOptions) {}

	get running(): boolean {
		return this.server !== null;
	}

	start(): Promise<void> {
		return new Promise((resolve, reject) => {
			if (this.server) return resolve();
			const max = this.opts.maxBytes ?? DEFAULT_MAX_BYTES;
			const server = http.createServer((req, res) =>
				this.handle(req, res, max)
			);
			server.on("error", (err) => {
				if (!this.server) {
					// 啟動階段(如埠被占用 EADDRINUSE)→ reject
					reject(err);
				} else {
					this.opts.onError?.(err as Error);
				}
			});
			// 綁 0.0.0.0:同 LAN 的 Kobo 才連得到;靠 token 擋未授權
			server.listen(this.opts.port, "0.0.0.0", () => {
				this.server = server;
				resolve();
			});
		});
	}

	stop(): void {
		if (this.server) {
			this.server.close();
			this.server = null;
		}
	}

	private reply(res: http.ServerResponse, code: number, msg: string): void {
		const body = Buffer.from(msg, "utf-8");
		res.writeHead(code, {
			"Content-Type": "text/plain; charset=utf-8",
			"Content-Length": body.length,
		});
		res.end(body);
	}

	private handle(
		req: http.IncomingMessage,
		res: http.ServerResponse,
		max: number
	): void {
		const url = (req.url || "").split("?")[0].replace(/\/+$/, "") || "/";

		// 健康檢查 / 測試連線
		if (req.method === "GET" && (url === "/" || url === "/ping")) {
			return this.reply(res, 200, "PaperFolio receiver OK");
		}
		if (req.method !== "POST" || url !== "/sync") {
			return this.reply(res, 404, "not found");
		}

		// 驗證共享密鑰
		if (this.opts.token) {
			const raw = req.headers[TOKEN_HEADER];
			const got = Array.isArray(raw) ? raw[0] : raw || "";
			if (got !== this.opts.token) return this.reply(res, 401, "bad token");
		}

		// 收 body 到記憶體(限流)
		const chunks: Buffer[] = [];
		let size = 0;
		let aborted = false;
		req.on("data", (c: Buffer) => {
			if (aborted) return;
			size += c.length;
			if (size > max) {
				aborted = true;
				this.reply(res, 413, "too large");
				req.destroy();
				return;
			}
			chunks.push(c);
		});
		req.on("end", async () => {
			if (aborted) return;
			if (size === 0) return this.reply(res, 400, "empty body");
			try {
				const msg = await this.opts.onSync(
					new Uint8Array(Buffer.concat(chunks))
				);
				this.reply(res, 200, msg);
			} catch (e) {
				this.reply(
					res,
					500,
					`error: ${e instanceof Error ? e.message : String(e)}`
				);
			}
		});
		req.on("error", () => {
			if (!aborted) this.reply(res, 400, "recv error");
		});
	}
}
