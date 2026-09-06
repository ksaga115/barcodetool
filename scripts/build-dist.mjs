// scripts/build-dist.mjs
// アプリ化（Capacitor/iOS）とは無関係な「配布版」を作る。
// BarcodeTool.html は外部依存ゼロの単一ファイルなので、やることは基本的にコピーだけ。
// 念のため、うっかり外部参照（<link>/<script src>/<img src>）が紛れ込んでいないかだけ検査する。
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = resolve(root, "BarcodeTool.html");
const OUT_DIR = resolve(root, "dist");
const OUT = resolve(OUT_DIR, "BarcodeTool.html");

if (!existsSync(SRC)) {
  console.error(`[build-dist] 元ファイルが見つかりません: ${SRC}`);
  process.exit(1);
}

const html = readFileSync(SRC, "utf8");

// 外部ファイル参照が紛れ込んでいたら警告（data: URI は除外）。
const suspects = [];
for (const m of html.matchAll(/<link\s[^>]*href=["']([^"']+)["']/gi)) suspects.push(["<link>", m[1]]);
for (const m of html.matchAll(/<script\s[^>]*src=["']([^"']+)["']/gi)) suspects.push(["<script src>", m[1]]);
for (const m of html.matchAll(/<img\s[^>]*src=["']([^"']+)["']/gi)) {
  if (!/^data:/i.test(m[1])) suspects.push(["<img src>", m[1]]);
}
if (suspects.length) {
  console.warn("[build-dist] 外部ファイル参照が見つかりました。配布版は単一HTMLの想定です:");
  suspects.forEach(([tag, ref]) => console.warn(`  ${tag}: ${ref}`));
} else {
  console.log("[build-dist] 外部ファイル参照なし（単一HTMLとして自己完結）を確認");
}

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT, html, "utf8");
// ホスティング時に URL をきれいにできるよう index.html も同じ内容で出しておく
const INDEX = resolve(OUT_DIR, "index.html");
writeFileSync(INDEX, html, "utf8");

console.log(`[build-dist] 生成: ${OUT} と ${INDEX}（各 ${(html.length / 1024).toFixed(0)} KB・中身は同じ）`);
console.log("[build-dist] ファイル1つをブラウザで開くだけで動きます。サーバー・インストール・ビルドは不要。");
console.log("[build-dist] ホスティングするなら index.html をアップロードすると URL がきれいになります。");
