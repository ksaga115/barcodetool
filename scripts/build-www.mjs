// scripts/build-www.mjs
// BarcodeTool.html を触らずに、Capacitor 用の www/ を生成する。
//  - viewport に viewport-fit=cover を付与（ノッチ対応）
//  - </head> 直前にネイティブ shim（保存/共有ブリッジ・セーブ同期・セーフエリア）を注入
//  - </body> 直前に Pro ゲート（課金・機能制限・ペイウォール）を注入
//  - native/ 配下を www/native/ にコピー
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = resolve(root, "BarcodeTool.html");
const OUT_DIR = resolve(root, "www");
const OUT = resolve(OUT_DIR, "index.html");

if (!existsSync(SRC)) {
  console.error(`[build-www] 元ファイルが見つかりません: ${SRC}`);
  process.exit(1);
}

let html = readFileSync(SRC, "utf8");
const before = html;

// 1) viewport-fit=cover
html = html.replace(
  /(<meta\s+name=["']viewport["']\s+content=["'])([^"']*?)(["']\s*\/?>)/i,
  (m, a, content, c) => (/viewport-fit/.test(content) ? m : `${a}${content}, viewport-fit=cover${c}`)
);

// 2) head 注入
const headInject = [
  '  <link rel="stylesheet" href="native/z-native.css">',
  '  <script src="native/z-capacitor-shim.js"></script>',
].join("\n");
if (!html.includes("native/z-capacitor-shim.js")) {
  html = html.replace(/<\/head>/i, `${headInject}\n</head>`);
}

// 3) body 末尾注入
const bodyInject = '  <script src="native/z-pro.js"></script>';
if (!html.includes("native/z-pro.js")) {
  html = html.replace(/<\/body>/i, `${bodyInject}\n</body>`);
}

if (html === before) {
  console.warn("[build-www] 注入ポイントが見つかりませんでした（HTML の構造を確認してください）");
}

rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT, html, "utf8");
cpSync(resolve(root, "native"), resolve(OUT_DIR, "native"), { recursive: true });

console.log(`[build-www] 生成: ${OUT}`);
