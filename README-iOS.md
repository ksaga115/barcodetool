# バーコードツール — iPhone アプリ化（Capacitor + 買い切り Pro）

`BarcodeTool.html`（単一HTML・外部通信なし）を **一切改変せず**、Capacitor で iOS アプリ化するための構成です。
ビルドの最終工程（`npx cap add ios` 以降）は **macOS + Xcode + CocoaPods** が必要です。
Windows ではここまでの雛形作成・Web資産生成まで可能です。

---

## 1. 追加されたファイル

| パス | 役割 |
|---|---|
| `package.json` / `capacitor.config.json` | Capacitor プロジェクト定義（`appId` は要変更、下記 §7） |
| `scripts/build-www.mjs` | `BarcodeTool.html` → `www/index.html` を生成。viewport 調整＋ネイティブ用スクリプトを注入するだけ（原本は不変） |
| `scripts/apply-ios-patch.mjs` | 生成済み iOS プロジェクトへネイティブ差分を適用（`ios-patch/` → `ios/`、Info.plist キー挿入） |
| `native/z-capacitor-shim.js` | `<head>` で読込。保存/共有ブリッジ・セーブのネイティブ同期・セーフエリア・ステータスバー。Web では no-op |
| `native/z-pro.js` | 無料/Pro の線引き・課金呼び出し・ペイウォール UI |
| `native/z-native.css` | ネイティブ時のみ効く CSS（セーフエリア、ペイウォール、トースト） |
| `ios-patch/App/ProPlugin.swift` / `ProPlugin.m` | StoreKit 2 の買い切りアンロック（Capacitor プラグイン `Pro`） |
| `ios-patch/App/Info.plist.additions.xml` | 追加する Info.plist キー（カメラ用途説明ほか） |
| `ios-patch/Products.storekit` | Xcode ローカルテスト用の課金設定ファイル |
| `assets/icon.svg` / `assets/splash.svg` | アイコン / 起動画面の元データ（`@capacitor/assets` で全サイズ生成） |

`www/` `ios/` `node_modules/` は生成物なので Git 管理外（`.gitignore` 済み）。

---

## 2. 無料 / Pro の線引き（`native/z-pro.js` 冒頭で変更可）

| | 無料 | **Pro（買い切り・非消費型 IAP）** |
|---|---|---|
| 読み取り（カメラ / 画像 / 貼り付け） | ○ 無制限 | ○ |
| 生成フォーマット | Code128 / EAN-13(JAN) / EAN-8 / UPC-A / QR | ＋ Code39 / Code39(C/D) / Code93 / ITF・ITF-14 / NW-7(Codabar) / UPC-E / DataMatrix |
| 1件ごとの PNG コピー / 保存 | ○ | ○ |
| **全件保存（PNG一括 / ZIP）** | ✗（ペイウォール） | ○ |
| コードバトル（収集・対戦・図鑑） | ○ 全機能 | ○ |
| ヘッダーの「✦ Pro」誘導 | 表示 | 「✓ Pro」表示に変わり誘導が消える |

ゲームを制限しないのは意図的です（継続率・口コミの中心なので、ここは絞らない）。

---

## 3. 事前準備（macOS）

```bash
xcode-select --install            # Command Line Tools
sudo gem install cocoapods        # or: brew install cocoapods
node -v                           # 18+ 推奨
```

Apple Developer Program（US$99/年）への登録が必要（実機テスト・配信・IAP すべてに必須）。

---

## 4. セットアップ（初回のみ）

```bash
npm install
npm run build                     # www/ を生成
npx cap add ios                   # ios/ を生成（macOS 必須）
npm run assets                    # アイコン・スプラッシュを一括生成
npm run patch:ios                 # ネイティブ差分を適用（ProPlugin.*, Info.plist）
npx cap open ios                  # Xcode で開く
```

Xcode 側で **一度だけ** 手動作業：

1. **ネイティブソースをターゲットに追加**
   Project Navigator の `App` グループを右クリック →「Add Files to "App"…」→
   `ios/App/App/ProPlugin.swift` と `ios/App/App/ProPlugin.m` を選択（"Copy items if needed" 不要、Target = App にチェック）。
   ※ `.m` 追加時に「Objective-C bridging header を作成しますか？」→ **Yes**（`App-Bridging-Header.h` 生成でOK。空のままで可）。
2. **Deployment Target を 15.0 に**（`App` ターゲット → General → Minimum Deployments。StoreKit 2 に必要）。
3. **Signing & Capabilities**
   - Team を選択、Bundle Identifier を自分のものに（§7）。
   - `+ Capability` →「In-App Purchase」を追加。
4. **ローカル課金テスト設定**（実 IAP 未作成でもテスト可）
   - `ios/App/Products.storekit` を Project Navigator にドラッグ追加。
   - Product > Scheme > Edit Scheme… > Run > Options > **StoreKit Configuration = Products.storekit**。

以降、Web 側を変えたら：

```bash
npm run sync                      # build + cap sync ios + patch:ios
```

---

## 5. 実機で動作確認するもの

- [ ] カメラ読み取り（初回に許可ダイアログ。`getUserMedia` は Info.plist の `NSCameraUsageDescription` 必須）
- [ ] 別スレッド解析（Web Worker：blob URL）が落ちないか
- [ ] 1件保存 / 全件保存 → **共有シート**が出る（`<a download>` は shim が Filesystem+Share に置換）
- [ ] 画像をクリップボードにコピー（失敗時は共有シートにフォールバック）
- [ ] コードバトルの進捗が再起動後も残る（`localStorage` ＋ ネイティブ Preferences ミラー）
- [ ] セーフエリア（ノッチ・ホームインジケータに UI が被らない）→ 被る場合は `native/z-native.css` のセレクタを実DOMに合わせて調整
- [ ] 「✦ Pro」→ ペイウォール → 購入（StoreKit テスト）→ 「✓ Pro」に変化、Pro フォーマットと全件保存が解放
- [ ] アプリ削除→再インストール→「購入を復元」で Pro が戻る

---

## 6. App Store Connect（配信前）

### 6-1. アプリレコード
- 新規 App を作成（Bundle ID = §7 で決めたもの）。
- スクリーンショット（6.7" / 6.5" 必須）。**1枚目はコードバトル**、以降に生成・読み取り。
- 「Appのプライバシー」：ほぼ全て「データを収集していません」。トラッキングなし。
  （広告 SDK・解析 SDK を入れていないので該当なし。IAP のための Apple との通信は宣言不要。）
- サポートURL・マーケティングURL、年齢レーティング（4+ 想定）。

### 6-2. 課金（非消費型）
- 「App内課金」→ **非消費型（Non-Consumable）** を新規作成。
  - **製品ID：`com.kokisagawa.barcodetool.pro`**（`native/z-pro.js` の `PRODUCT_ID` と `ProPlugin.swift` の `productID` に一致させる）
  - 参照名：`Pro Unlock`
  - 価格：Tier 設定（推奨 ¥600 前後 / US$4.99）
  - ローカリゼーション（日本語・英語）：表示名「バーコードツール Pro」、説明「追加フォーマットと全件保存を解放する買い切りアンロック」
  - 審査用スクリーンショット：ペイウォール画面のキャプチャを添付
- 初回申請は **アプリのバイナリと同時に** 審査に出す（IAP 単体だと "Missing Metadata" で止まる）。

### 6-3. プライバシーポリシー（必須）
- `ios-patch/privacy.html` を GitHub Pages / Gist などで公開。
- 公開URLを **2箇所** に設定：
  1. App Store Connect の「プライバシーポリシーURL」
  2. `native/z-pro.js` の `PRIVACY_URL`（ペイウォールのリンク先）
- EULA は Apple 標準（`native/z-pro.js` の `EULA_URL`）のままで可。独自 EULA を使う場合は App Store Connect にも登録。

### 6-4. 提出
```bash
npm run sync
```
Xcode → Product > Archive → Distribute App → App Store Connect → アップロード → TestFlight で確認 → 審査提出。

---

## 7. 必ず変更する箇所

| 場所 | 現在（プレースホルダ） | 変更内容 |
|---|---|---|
| `capacitor.config.json` → `appId` | `com.kokisagawa.barcodetool` | 自分の逆ドメイン（例 `com.〈あなた〉.barcodetool`） |
| `native/z-pro.js` → `PRODUCT_ID` | `com.kokisagawa.barcodetool.pro` | App Store Connect の製品IDと一致 |
| `ios-patch/App/ProPlugin.swift` → `productID` | 同上 | 同上 |
| `ios-patch/Products.storekit` → `productID` | 同上 | 同上 |
| `native/z-pro.js` → `PRIVACY_URL` | `https://kokisagawa.github.io/...` | 実際に公開した URL |

`appId` を変えたら `npx cap sync ios`、既に `ios/` を作成済みなら一度削除して `npx cap add ios` からやり直すのが確実。

---

## 8. 収益設計（要点）

- **買い切り 1 本（非消費型 IAP）**。サブスクなし、広告なし、サーバなし → **固定費は Apple の US$99/年 のみ**、売上はほぼ全額利益。
- 広告を入れない理由：通信発生でこのアプリ唯一の売り（オフライン・プライバシー）が消える／ATT・UMP 同意と審査リスク／無名アプリの実収益は月数百円規模で割に合わない。
- 伸びてから足せる余地（今回は未実装）：ゲーム内の消費型 IAP（復活・ガチャ）、動画リワード（ゲーム内だけ・任意）、収集枠の有料拡張。
- 現実的な初期見込み：無マーケなら **月 0〜数万円**。伸びる要因はコードバトルの継続率と口コミのみ。だからこそ「固定費ゼロで赤字にならない」設計にしてある。
- ASO：ユーティリティ検索（`バーコード 作成`, `QRコード 読み取り`, `まとめて 保存`）とゲームの二方向。スクショ1枚目はゲーム、バッジで「オフライン・広告なし」を訴求。

---

## 9. 仕組みメモ（改修時の参考）

- **原本不変**：`build-www.mjs` は viewport に `viewport-fit=cover` を足し、`</head>` 前に `z-native.css`＋`z-capacitor-shim.js`、`</body>` 前に `z-pro.js` を注入するだけ。`BarcodeTool.html` は触らない。
- **保存/共有**：`z-capacitor-shim.js` が `HTMLAnchorElement.prototype.click` を差し替え、`download` 属性付き blob:/data: を `@capacitor/filesystem` に書いて `@capacitor/share` で共有シートへ。
- **セーブ永続化**：`localStorage.setItem` をラップし、`barcode_codebeast_v1` ほか重要キーを `@capacitor/preferences`（ネイティブ UserDefaults）へミラー。起動時、localStorage が空で Preferences に在れば埋め戻して 1 回だけ reload。
- **課金**：`z-pro.js` → `Capacitor.Plugins.Pro`（`ProPlugin.swift`）。`getStatus` / `purchase` / `restore`。`Transaction.currentEntitlements` で所有判定、`Transaction.updates` を購読して `proStatusChanged` を JS に通知。所有状態は `localStorage['bt_pro_owned']` に UI ヒントとしてキャッシュ（正はネイティブ側）。
- **ゲート**：`z-pro.js` が document のキャプチャフェーズで `.dd-item[data-value=<proフォーマット>]` クリックと `#btn-export-all` クリックを横取りしてペイウォール表示。`change` でも Pro フォーマットを `code128` に戻す（保存状態復元対策）。
