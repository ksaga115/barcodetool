// scripts/domcheck.mjs
// jsdom で BarcodeTool.html の「コードバトル」画面を実際に動かし、
// 初期化・サンプル投入・1体対戦・スカッド・ガントレットを一通り叩いて
// 例外や DOM 崩れ（描画されない等）を検出する。
import fs from "node:fs";
import { JSDOM, VirtualConsole } from "jsdom";

const SRC = "C:/Tools/BarcodeTool/BarcodeTool.html";
let html = fs.readFileSync(SRC, "utf8");

// 生成/読み取り側スクリプト（CB を含まないもの）を無効化。ゲーム用スクリプトだけ残す。
html = html.replace(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g, (m, body) =>
  (body.includes("const CB = (function () {") || body.includes("BACKUP_KEYS")) ? m : "<script></script>"
);
// スタブを注入
html = html.replace(/<\/head>/i, `
<script>
  window.showToast = function(){};
  window.switchView = function(){};
  window.addRow = function(){};
  window.verifyGenerated = function(){};
  window.confirm = function(){ return true; };
  window.alert = function(){};
  try { window.location.reload = function(){}; } catch (e) {}
  // jsdom は Blob URL / File を作れないので最低限のダミーを用意（実ブラウザには存在する標準API）
  if (!window.URL.createObjectURL) window.URL.createObjectURL = function(){ return "blob:stub"; };
  if (!window.URL.revokeObjectURL) window.URL.revokeObjectURL = function(){};
  if (!window.Element.prototype.scrollIntoView) window.Element.prototype.scrollIntoView = function(){};
</script>
</head>`);

// jsdom が「実装していない」だけの想定内の事象（実ブラウザでは正常動作する）はエラー数に数えない。
const BENIGN_JSDOM_ERROR = /navigation to another Document|Not implemented: HTMLCanvasElement/;
const errors = [];
const vc = new VirtualConsole();
vc.on("jsdomError", (e) => {
  const msg = String(e && (e.stack || e.message) || e);
  if (BENIGN_JSDOM_ERROR.test(msg)) { console.log("    [jsdom制限（想定内・実ブラウザでは無害）] " + msg.split("\n")[0]); return; }
  errors.push("jsdomError: " + msg);
});
vc.on("error", (...a) => errors.push("console.error: " + a.join(" ")));

const dom = new JSDOM(html, {
  url: "http://localhost/",
  runScripts: "dangerously",
  pretendToBeVisual: true,
  virtualConsole: vc,
});
const { window } = dom;
const doc = window.document;
window.addEventListener("error", (e) => errors.push("window.error: " + (e.error && e.error.stack || e.message)));

const $ = (id) => doc.getElementById(id);
const click = (el) => { if (!el) throw new Error("click: element not found"); el.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true })); };
const sleep = (ms) => new Promise((r) => window.setTimeout(r, ms));

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (extra ? "  — " + extra : "")); }
}

// 自前の確認モーダル（cbConfirm）が開いていたら「実行する」を押す
function confirmYes() {
  const yes = doc.getElementById("cb-confirm-yes");
  if (yes) { click(yes); return true; }
  return false;
}

// 2階層タブ（編成/対戦/今日の挑戦 → その中のサブモード）へ移動するヘルパ
const CB_TOP_OF = { squadform: "formation", fusion: "formation", "1v1": "battle", squadbattle: "battle", rival: "battle", gauntlet: "gauntlet" };
function gotoMode(mode) {
  const top = CB_TOP_OF[mode];
  const topBtn = [...doc.querySelectorAll(".cb-topbtn")].find((b) => b.dataset.top === top);
  if (topBtn) click(topBtn);
  if (top !== "gauntlet") {
    const sub = [...doc.querySelectorAll(".cb-subbtn")].find((b) => b.dataset.mode === mode);
    if (sub) click(sub);
  }
}

async function run() {
  await sleep(50); // 初期化

  check("window.CodeBeast が公開されている", !!window.CodeBeast);
  check("⚔ タブ #game-main が存在", !!$("game-main"));
  check("初期は空コレクション表示", /まだ1体もいません|サンプル/.test(($("cb-list") || {}).innerHTML || ""));

  // --- サンプル投入 ---
  click($("cb-btn-sample"));
  await sleep(20);
  const items = doc.querySelectorAll("#cb-list .cb-item");
  check("サンプル投入で一覧に個体が出る", items.length >= 10, "items=" + items.length);
  check("フィルタチップが生成された", doc.querySelectorAll("#cb-filters .cb-chip").length >= 10);

  // --- 狭い画面用のコレクション/対戦 切替（クラスの付け外しだけ確認。CSSの見た目はjsdomでは検証不可）---
  const gm = $("game-main");
  const vRight = [...doc.querySelectorAll("#cb-viewswitch .cb-viewbtn")].find((b) => b.dataset.view === "right");
  const vLeft = [...doc.querySelectorAll("#cb-viewswitch .cb-viewbtn")].find((b) => b.dataset.view === "left");
  check("コレクション/対戦の切替ボタンがある", !!vRight && !!vLeft && !!$("cb-back-to-list"));
  click(vRight); await sleep(5);
  check("「対戦・育成」で show-detail が付く", gm.classList.contains("show-detail"));
  click($("cb-back-to-list")); await sleep(5);
  check("「コレクションへ」で show-detail が外れる", !gm.classList.contains("show-detail"));

  // --- 1体対戦 ---
  const first = doc.querySelector("#cb-list .cb-item");
  click(first);
  await sleep(10);
  check("個体を選ぶと詳細カードが出る", /cb-card/.test(($("cb-detail") || {}).innerHTML || ""));
  // A/B は上位2体セットで
  click($("cb-btn-top2"));
  await sleep(10);
  check("「気になる2体で対戦」でスロットが埋まる", /cb-slot-name/.test(($("cb-slot-a") || {}).innerHTML || ""));
  click($("cb-fight"));
  await sleep(30);
  click($("cb-skip"));            // 演出を飛ばして即結果
  await sleep(30);
  check("1体対戦で MATCH RESULT が出る", /cb-winner/.test(($("cb-battle") || {}).innerHTML || ""));

  // --- フィルタ / アーカイブ切替 ---
  const archChip = [...doc.querySelectorAll("#cb-filters .cb-chip")].find((c) => c.dataset.f === "archived");
  click(archChip);
  await sleep(10);
  check("アーカイブ切替でクラッシュしない", true);
  click(archChip); // 戻す
  await sleep(10);

  // --- 編成 > スカッド編成 ---
  gotoMode("squadform");
  await sleep(10);
  check("スカッド編成のパネルが表示", $("cb-mode-squadform") && !$("cb-mode-squadform").hidden);
  check("編成スロットが3つ", doc.querySelectorAll("#cb-squad-mine .cb-squad-slot").length === 3);

  // 3体を編成（一覧は select 毎に再描画されるので data-code で毎回引き直す）
  const targetCodes = [...doc.querySelectorAll("#cb-list .cb-item")].slice(0, 3).map((el) => el.dataset.code);
  const slots = () => doc.querySelectorAll("#cb-squad-mine .cb-squad-slot");
  const itemByCode = (c) => [...doc.querySelectorAll("#cb-list .cb-item")].find((el) => el.dataset.code === c);
  for (let i = 0; i < 3; i++) {
    click(itemByCode(targetCodes[i]));   // コレクションで選択（再描画対応）
    await sleep(5);
    click(slots()[i]);                   // スロットに配置
    await sleep(5);
  }
  check("3スロットが filled になった", [...slots()].every((s) => s.classList.contains("filled")),
    [...slots()].map((s) => s.className).join(" | "));
  check("編成info にシナジー/共鳴の記述", /発動|属性/.test(($("cb-squad-info") || {}).innerHTML || ""));

  // --- スカッドのプリセット（保存・読み込み・削除）--- ※この時点ではまだ const T 前なので __test を直接参照
  const Tp = window.CodeBeast.__test;
  check("プリセット保存ボタンがある", !!$("cb-preset-save"));
  click($("cb-preset-save")); await sleep(5);
  const pi = doc.getElementById("cb-prompt-input");
  if (pi) { pi.value = "先発"; click(doc.getElementById("cb-prompt-ok")); await sleep(10); }
  check("編成が1つ保存される", Tp.store.squadPresets.length === 1 && Tp.store.squadPresets[0].name === "先発");
  // 別の編成に変えてから、プリセットを読み直す
  const other3 = [...doc.querySelectorAll("#cb-list .cb-item")].map((el) => el.dataset.code).filter((c) => targetCodes.indexOf(c) < 0).slice(0, 3);
  if (other3.length === 3) {
    Tp.store.squad = { front: other3[0], mid: other3[1], back: other3[2] };
    Tp.renderStatus(); await sleep(5);
    click(doc.querySelector('#cb-squad-presets button[data-preset="0"]')); await sleep(10);
    check("プリセット読み込みで自隊が戻る", Tp.store.squad.front === targetCodes[0] && Tp.store.squad.back === targetCodes[2]);
  }
  click(doc.querySelector('#cb-squad-presets button[data-preset-del="0"]')); await sleep(10);
  check("プリセット削除で0個になる", Tp.store.squadPresets.length === 0);

  // --- 対戦 > スカッド対戦 ---
  gotoMode("squadbattle");
  await sleep(10);
  check("スカッド対戦のパネルが表示", $("cb-mode-squadbattle") && !$("cb-mode-squadbattle").hidden);
  check("自隊のプレビューが表示される", doc.querySelectorAll("#cb-squad-mine-peek .cb-squad-slot").length === 3);
  click($("cb-squad-rand"));
  await sleep(10);
  check("相手スカッドが表示された", doc.querySelectorAll("#cb-squad-foe .cb-squad-slot").length >= 1);
  click($("cb-squad-fight"));
  await sleep(30);
  click($("cb-squad-skip"));
  await sleep(30);
  check("スカッド対戦で結果カードが出る", /cb-winner/.test(($("cb-battle") || {}).innerHTML || ""));

  // --- 今日の挑戦 ---
  gotoMode("gauntlet");
  await sleep(10);
  const rungs = doc.querySelectorAll("#cb-gaunt-ladder .cb-gaunt-rung");
  check("ガントレットの梯子が5段", rungs.length === 5, "rungs=" + rungs.length);
  const challengeBtn = doc.querySelector('#cb-gaunt-ladder button[data-gr="1"]');
  check("1段目に挑戦ボタンがある（編成済みなので）", !!challengeBtn);
  if (challengeBtn) {
    const T0 = window.CodeBeast.__test;
    const shardsBefore = Object.values(T0.store.shards).reduce((a, b) => a + b, 0);
    click(challengeBtn);
    await sleep(30);
    click($("cb-gaunt-skip"));
    await sleep(30);
    check("ガントレット対戦で結果カードが出る", /cb-winner/.test(($("cb-battle") || {}).innerHTML || ""));
    check("挑戦後も梯子が再描画される", doc.querySelectorAll("#cb-gaunt-ladder .cb-gaunt-rung").length === 5);
    const won = /自隊の勝ち/.test(($("cb-battle") || {}).innerHTML || "");
    const shardsAfter = Object.values(T0.store.shards).reduce((a, b) => a + b, 0);
    if (won) check("初突破で欠片が増える", shardsAfter > shardsBefore, shardsBefore + " -> " + shardsAfter);
    else console.log("    [info] 1段目は今回のシードでは敗北だったため欠片チェックはスキップ");
  }

  // --- 発見（読み取り経由）＋ session/family タグ ---
  const r = window.CodeBeast.discover("4901234567894", "ean13", "EAN-13 / JAN");
  check("discover が entry を返す", r && r.entry && typeof r.entry.session === "number" && r.entry.family, JSON.stringify(r && r.entry));

  // --- v2.5 育成（進化・強化） ---
  const T = window.CodeBeast.__test;
  check("テストフックが使える", !!(T && T.store && T.effectiveBeast));
  // JAN:49 系統を3種そろえて解放条件を満たす
  ["4900000000009", "4911111111112", "4922222222225"].forEach((c) => window.CodeBeast.discover(c, "ean13", "EAN-13 / JAN"));
  T.grantShards("JAN:49", 40);
  // 1体対戦モードに戻して JAN:49 を選択
  gotoMode("1v1");
  await sleep(10);
  const janCode = window.CodeBeast.normalize("4901234567894");
  T.store.sel = janCode; T.renderStatus();
  await sleep(10);
  check("育成パネルが詳細カードに出る", /cb-grow/.test(($("cb-detail") || {}).innerHTML || ""));
  const evoBtn = doc.querySelector('#cb-detail button[data-grow="evo"]');
  check("進化ボタンがある", !!evoBtn);
  check("系統3種＋欠片40 で進化ボタンが有効", evoBtn && !evoBtn.disabled);

  const before = T.effectiveBeast(janCode);
  click(doc.querySelector('#cb-detail button[data-grow="boost"][data-stat="ATK"]'));
  await sleep(10);
  const afterBoost = T.effectiveBeast(janCode);
  check("強化で実効ATKが上がる", afterBoost.stats.ATK > before.stats.ATK, before.stats.ATK + " -> " + afterBoost.stats.ATK);

  click(doc.querySelector('#cb-detail button[data-grow="evo"]'));
  await sleep(10);
  const afterEvo = T.effectiveBeast(janCode);
  check("進化で evo が1になり称号が付く", afterEvo.evo === 1 && afterEvo.name !== before.baseName, afterEvo.name);
  check("進化で実効TOTALが素体より上", afterEvo.total > afterEvo.baseTotal, afterEvo.baseTotal + " -> " + afterEvo.total);

  click(doc.querySelector('#cb-detail button[data-grow="polish"]'));
  await sleep(10);
  check("研磨で polish が1になる", (T.store.beasts[janCode] || {}).polish === 1);

  // --- 育成リセット（詳細カードのボタン）---
  T.store.sel = janCode; T.renderStatus(); await sleep(10);
  const resetBtn = doc.querySelector('#cb-detail button[data-act="resetgrow"]');
  check("育成済みだと「育成をリセット」ボタンが出る", !!resetBtn);
  if (resetBtn) {
    click(resetBtn); await sleep(5); confirmYes(); await sleep(10);
    check("リセットで evo/boost/polish が 0 に戻る",
      (T.store.beasts[janCode].evo === 0 && T.store.beasts[janCode].polish === 0 && Object.keys(T.store.beasts[janCode].boost).length === 0));
  }

  // --- 愛称（改名）---
  T.store.sel = janCode; T.renderStatus(); await sleep(10);
  const renameBtn = doc.querySelector('#cb-detail button[data-act="rename"]');
  check("詳細カードに改名ボタン(✏)がある", !!renameBtn);
  if (renameBtn) {
    click(renameBtn); await sleep(5);
    const pInput = doc.getElementById("cb-prompt-input");
    check("改名は入力モーダルを出す", !!pInput);
    if (pInput) {
      pInput.value = "エース";
      click(doc.getElementById("cb-prompt-ok")); await sleep(10);
      check("愛称が保存される", T.store.beasts[janCode].nick === "エース");
      check("一覧・詳細に愛称が出る", /エース/.test(($("cb-detail") || {}).innerHTML || "") && /エース/.test(($("cb-list") || {}).innerHTML || ""));
    }
  }

  // --- 譲渡コード（作成→取り込みラウンドトリップ）---
  const giftText = T.buildGiftCode(janCode);
  check("譲渡コードが作れる", typeof giftText === "string" && giftText.indexOf("CBG1:") === 0);
  const nickWas = T.store.beasts[janCode].nick;
  delete T.store.beasts[janCode]; // 別端末を模して一旦消す
  const gres = T.importGift(giftText);
  check("譲渡コードの取り込みでコレクションに戻る", !!(gres && !gres.already && T.store.beasts[janCode]));
  check("譲渡で愛称も引き継がれる", T.store.beasts[janCode].nick === nickWas);
  check("譲渡コードは maybeImportChallenge のガードにも乗る", window.CodeBeast.maybeImportChallenge(giftText) === true);

  // --- 図鑑の統計モーダル ---
  click($("cb-stats-btn")); await sleep(10);
  check("図鑑の統計モーダルが開く", /図鑑の統計/.test(doc.body.innerHTML) && !!doc.querySelector(".cb-stat-grid"));
  const statsX = doc.getElementById("cb-stats-x");
  if (statsX) { click(statsX); await sleep(5); }
  check("統計モーダルが閉じる", !doc.querySelector(".cb-stat-grid"));

  // 育成後にその個体で1体対戦してもクラッシュしない
  T.store.slots.a = janCode;
  const otherCode = [...doc.querySelectorAll("#cb-list .cb-item")].map((el) => el.dataset.code).find((c) => c !== janCode);
  T.store.slots.b = otherCode; T.renderStatus();
  await sleep(10);
  click($("cb-fight")); await sleep(30); click($("cb-skip")); await sleep(30);
  check("育成済み個体で1体対戦→結果が出る", /cb-winner/.test(($("cb-battle") || {}).innerHTML || ""));

  // 溶解（アーカイブ個体を欠片に）
  const arcCode = window.CodeBeast.normalize("TACOCAT");
  if (T.store.beasts[arcCode]) { T.store.archive[arcCode] = T.store.beasts[arcCode]; delete T.store.beasts[arcCode]; }
  const totalShardsBefore = Object.values(T.store.shards).reduce((a, b) => a + b, 0);
  const archChip2 = [...doc.querySelectorAll("#cb-filters .cb-chip")].find((c) => c.dataset.f === "archived");
  click(archChip2); await sleep(10);
  T.store.sel = arcCode; T.renderStatus(); await sleep(10);
  const disBtn = doc.querySelector('#cb-detail button[data-act="dissolve"]');
  check("アーカイブ個体に「欠片にする」ボタン", !!disBtn);
  if (disBtn) {
    click(disBtn); await sleep(5);
    check("溶解は確認モーダルを出す", confirmYes()); await sleep(10);
    const totalShardsAfter = Object.values(T.store.shards).reduce((a, b) => a + b, 0);
    check("溶解で欠片が増え、アーカイブから消える", !T.store.archive[arcCode] && totalShardsAfter > totalShardsBefore);
  }
  click(archChip2); await sleep(10);

  // --- 編成 > 融合 ---
  gotoMode("fusion");
  await sleep(10);
  check("融合モードのパネルが表示", $("cb-mode-fusion") && !$("cb-mode-fusion").hidden);
  check("融合スロットが2つ", doc.querySelectorAll("#cb-fusion-slots .cb-squad-slot").length === 2);
  check("系譜は最初「まだ融合していません」表示", /まだ融合した個体がいません/.test(($("cb-fusion-tree") || {}).innerHTML || ""));

  const fuseCodes = [...doc.querySelectorAll("#cb-list .cb-item")].slice(0, 2).map((el) => el.dataset.code);
  T.grantShards(T.store.beasts[fuseCodes[0]].family || "MISC", 50);
  T.grantShards(T.store.beasts[fuseCodes[1]].family || "MISC", 50);
  const fuseItemByCode = (c) => [...doc.querySelectorAll("#cb-list .cb-item")].find((el) => el.dataset.code === c);
  for (let i = 0; i < 2; i++) {
    click(fuseItemByCode(fuseCodes[i]));
    await sleep(5);
    click(doc.querySelectorAll("#cb-fusion-slots .cb-squad-slot")[i]);
    await sleep(5);
  }
  check("2スロットとも filled になった", [...doc.querySelectorAll("#cb-fusion-slots .cb-squad-slot")].every((s) => s.classList.contains("filled")));
  const fuseDoBtn = $("cb-fusion-do");
  check("融合コストの案内が出て、融合するボタンが有効になる", fuseDoBtn && !fuseDoBtn.disabled, ($("cb-fusion-info") || {}).innerHTML);

  const beastsBefore = Object.keys(T.store.beasts).length;
  click(fuseDoBtn);
  await sleep(10);
  // 親2体がコレクションから抜けてアーカイブへ、子1体が新規追加 → コレクションの数は -1
  check("融合で親2体が抜け子1体が増える（コレクション数 -1）", Object.keys(T.store.beasts).length === beastsBefore - 1, "before=" + beastsBefore + " after=" + Object.keys(T.store.beasts).length);
  check("融合した2体はアーカイブに移った（削除ではない）", !!T.store.archive[fuseCodes[0]] && !!T.store.archive[fuseCodes[1]]);
  check("系譜に融合の記録が表示される", /cb-fuse-row/.test(($("cb-fusion-tree") || {}).innerHTML || ""));
  const fusedNode = doc.querySelector(".cb-fuse-node.child[data-code]");
  check("系譜に子ノード（融合結果）がある", !!fusedNode);
  if (fusedNode) {
    click(fusedNode);
    await sleep(10);
    check("系譜の子ノードをクリックすると1体対戦モードに切り替わる", $("cb-mode-1v1") && !$("cb-mode-1v1").hidden);
  }

  // --- 対戦 > 対人（挑戦状）---
  gotoMode("rival");
  await sleep(10);
  check("対人モードのパネルが表示", $("cb-mode-rival") && !$("cb-mode-rival").hidden);
  check("スカッド編成済みなら書き出しボタンが使える案内", !/3体編成すると/.test(($("cb-rival-export") || {}).innerHTML || ""));

  $("cb-rival-name").value = "ためし挑戦者";
  click($("cb-rival-export-btn"));
  await sleep(10);
  const rivalText = $("cb-rival-text");
  check("挑戦状のテキストが書き出される", !!rivalText && rivalText.value.startsWith("CBX1:"), (rivalText || {}).value);

  const rivalsBefore = Object.keys(T.store.rivals).length;
  $("cb-rival-import").value = rivalText.value;
  click($("cb-rival-import-btn"));
  await sleep(10);
  check("挑戦状を読み込むと一覧に増える", Object.keys(T.store.rivals).length === rivalsBefore + 1);
  check("読み込んだ挑戦状の一覧行が描画される", /cb-rival-row/.test(($("cb-rival-list") || {}).innerHTML || ""));
  check("挑戦状の名前が反映される", /ためし挑戦者/.test(($("cb-rival-list") || {}).innerHTML || ""));

  const rivalId = Object.keys(T.store.rivals)[0];
  const fightBtn = doc.querySelector('button[data-rv-fight="' + rivalId + '"]');
  check("挑戦状に対戦ボタンがある", !!fightBtn);
  const shardsBeforeRival = Object.values(T.store.shards).reduce((a, b) => a + b, 0);
  click(fightBtn);
  await sleep(30);
  click($("cb-rival-skip"));
  await sleep(30);
  check("対人戦で結果カードが出る", /cb-winner/.test(($("cb-battle") || {}).innerHTML || ""));
  check("対戦後に勝敗が記録される", (T.store.rivals[rivalId].wins + T.store.rivals[rivalId].losses) === 1);

  const rivalWon = T.store.rivals[rivalId].wins === 1;
  const shardsAfterRival = Object.values(T.store.shards).reduce((a, b) => a + b, 0);
  check("対人戦の勝利で欠片がもらえる（敗北時は変化なし）",
    rivalWon ? shardsAfterRival > shardsBeforeRival : shardsAfterRival === shardsBeforeRival,
    "won=" + rivalWon + " before=" + shardsBeforeRival + " after=" + shardsAfterRival);

  if (rivalWon) {
    const shardsBefore2 = Object.values(T.store.shards).reduce((a, b) => a + b, 0);
    click(doc.querySelector('button[data-rv-fight="' + rivalId + '"]'));
    await sleep(30);
    click($("cb-rival-skip"));
    await sleep(30);
    const shardsAfter2 = Object.values(T.store.shards).reduce((a, b) => a + b, 0);
    check("同じ相手からの欠片は1日1回まで（連戦しても増えない）", shardsAfter2 === shardsBefore2, "before=" + shardsBefore2 + " after=" + shardsAfter2);
    check("勝敗数はそれでも毎回加算される", T.store.rivals[rivalId].wins === 2);
  }

  // 通常の鑑定/発見に混ざらない（挑戦状の文字列から変な個体が生まれない）
  const beastsBeforeChallenge = Object.keys(T.store.beasts).length;
  const handled = T.maybeImportChallenge(rivalText.value);
  check("挑戦状の文字列は通常発見の対象にならない（ガードが true を返す）", handled === true);
  check("挑戦状の読み込みでコレクションに変な個体が増えない", Object.keys(T.store.beasts).length === beastsBeforeChallenge);

  // 壊れた挑戦状は例外を出さず null
  check("壊れた挑戦状はエラーを出さず読み込み失敗になる", T.importChallenge("CBX1:{not valid json") === null);
  check("挑戦状でない普通の文字列は無視される（false）", T.maybeImportChallenge("4901234567894") === false);

  const delBtn = doc.querySelector('button[data-rv-del="' + rivalId + '"]');
  click(delBtn);
  await sleep(5);
  confirmYes();
  await sleep(10);
  check("挑戦状を削除するとコレクションから消える", !T.store.rivals[rivalId]);

  // --- コレクションから個体を削除（iOSで confirm が効かない問題の回帰確認）---
  gotoMode("1v1");
  await sleep(5);
  const someItem = doc.querySelector("#cb-list .cb-item");
  const victimCode = someItem && someItem.dataset.code;
  check("削除対象の個体がいる", !!victimCode && !!T.store.beasts[victimCode]);
  click(someItem); await sleep(10); // 選択して詳細カードを出す
  const delOne = doc.querySelector('#cb-detail button[data-act="del"]');
  check("詳細カードに「コレクションから削除」ボタンがある", !!delOne);
  click(delOne); await sleep(5);
  check("削除は確認モーダルを出す", !!doc.getElementById("cb-confirm-yes"));
  // まだ削除されていない（確認前）
  check("確認前は削除されない", !!T.store.beasts[victimCode]);
  confirmYes(); await sleep(10);
  check("確認して個体がコレクションから消える", !T.store.beasts[victimCode] && !T.store.archive[victimCode]);
  // キャンセルの動作も確認
  const item2 = doc.querySelector("#cb-list .cb-item");
  const keepCode = item2 && item2.dataset.code;
  click(item2); await sleep(10);
  click(doc.querySelector('#cb-detail button[data-act="del"]')); await sleep(5);
  const noBtn = doc.getElementById("cb-confirm-no");
  if (noBtn) click(noBtn);
  await sleep(10);
  check("キャンセルすると個体は残る", !!T.store.beasts[keepCode]);

  // --- localStorage 保存の形 ---
  await sleep(300); // saveStore のデバウンス
  const saved = window.localStorage.getItem("barcode_codebeast_v2");
  let ok = false;
  try { const o = JSON.parse(saved); ok = o && o.beasts && o.squad && o.gauntlet; } catch (e) {}
  check("v2 セーブが書き込まれ、squad/gauntlet を含む", ok);

  // --- バックアップ（書き出し／読み込み） ---
  click($("btn-backup"));
  await sleep(10);
  check("バックアップモーダルが開く", $("backup-modal") && $("backup-modal").classList.contains("show"));
  click($("backup-export"));
  await sleep(10);
  check("バックアップ書き出しで例外が出ない", true); // 例外なら run() 全体が catch されて exit(2) になる

  // 読み込み: 別内容の v2 セーブを含む JSON を File として注入し、実際に import 処理を通す
  const savedBefore = window.localStorage.getItem("barcode_codebeast_v2");
  const fakeBackup = JSON.stringify({
    app: "BarcodeTool", backupVersion: 1,
    values: { barcode_codebeast_v2: JSON.stringify({ v: 2, sel: "", slots: { a: "", b: "" }, beasts: {}, archive: {}, rematch: {}, squad: { front: "", mid: "", back: "" }, gauntlet: { day: 0, cleared: 0, streak: 0, lastWinDay: -1 }, shards: { "IMPORTED": 999 } }) }
  });
  const file = new window.File([fakeBackup], "backup.json", { type: "application/json" });
  const input = $("backup-import-file");
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  try { input.dispatchEvent(new window.Event("change", { bubbles: true })); } catch (e) { /* jsdom の location.reload 未実装は無視 */ }
  await sleep(40);
  confirmYes(); // 復元の確認モーダルで「実行する」
  await sleep(40);
  const savedAfter = window.localStorage.getItem("barcode_codebeast_v2");
  let importedOk = false;
  try { importedOk = JSON.parse(savedAfter).shards.IMPORTED === 999; } catch (e) {}
  check("バックアップの読み込みで localStorage が書き換わる", importedOk, "before=" + (savedBefore || "").length + " after=" + (savedAfter || "").length);

  console.log("\n" + pass + " passed, " + fail + " failed, " + errors.length + " runtime error(s)");
  if (errors.length) { console.log("\n--- runtime errors ---"); errors.forEach((e) => console.log(e)); }
  process.exit(fail || errors.length ? 1 : 0);
}

run().catch((e) => { console.error("HARNESS THREW:", e); process.exit(2); });
