// scripts/apply-ios-patch.mjs
// `npx cap add ios` の後に実行する。ネイティブ側の原本（ios-patch/）を
// 生成済み iOS プロジェクトへコピーし、Info.plist に必要キーを差し込む。
//
// 注意: .swift / .m を初回コピーした後は Xcode で一度だけ
//       「Add Files to "App"...」でターゲットに追加する必要がある（README-iOS.md 参照）。
import { readFileSync, writeFileSync, copyFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const iosApp = resolve(root, "ios", "App");
const iosAppApp = resolve(iosApp, "App");

if (!existsSync(iosAppApp)) {
  console.error("[patch:ios] ios/App/App が見つかりません。先に `npx cap add ios` を実行してください。");
  process.exit(1);
}

// 1) ネイティブソースをコピー
for (const f of ["ProPlugin.swift", "ProPlugin.m"]) {
  copyFileSync(resolve(root, "ios-patch", "App", f), resolve(iosAppApp, f));
  console.log(`[patch:ios] コピー: App/${f}`);
}
copyFileSync(resolve(root, "ios-patch", "Products.storekit"), resolve(iosApp, "Products.storekit"));
console.log("[patch:ios] コピー: Products.storekit");

// 2) Info.plist へキー挿入（未挿入のものだけ）
const plistPath = resolve(iosAppApp, "Info.plist");
let plist = readFileSync(plistPath, "utf8");
const entries = [
  ["NSCameraUsageDescription", "<string>バーコード・QRコードをカメラで読み取るために使用します。画像は端末内で処理され、外部に送信されません。</string>"],
  ["ITSAppUsesNonExemptEncryption", "<false/>"],
];
const closeIdx = plist.lastIndexOf("</dict>");
if (closeIdx < 0) {
  console.error("[patch:ios] Info.plist の </dict> が見つかりません。手動で追記してください（ios-patch/App/Info.plist.additions.xml 参照）。");
  process.exit(1);
}
let insert = "";
let added = 0;
for (const [key, valueXml] of entries) {
  if (plist.includes(`<key>${key}</key>`)) continue;
  insert += `\t<key>${key}</key>\n\t${valueXml}\n`;
  added++;
  console.log(`[patch:ios] Info.plist に追加: ${key}`);
}
if (added) {
  plist = plist.slice(0, closeIdx) + insert + plist.slice(closeIdx);
  writeFileSync(plistPath, plist, "utf8");
} else {
  console.log("[patch:ios] Info.plist は変更なし（既に適用済み）");
}

console.log("\n[patch:ios] 完了。Xcode でまだなら App グループに ProPlugin.swift / ProPlugin.m を追加してください。");
