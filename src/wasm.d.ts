// 讓 TypeScript 認得 esbuild 以 binary loader 內嵌的 .wasm(回傳 Uint8Array)。
declare module "*.wasm" {
	const content: Uint8Array;
	export default content;
}
