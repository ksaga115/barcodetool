/* native/z-pro.js
 * 無料 / Pro の線引きと課金（StoreKit 2 経由 = ネイティブ "Pro" プラグイン）。
 * Web ではペイウォールを開くと「この環境では購入できません」と表示するだけ（ゲート自体は掛かる）。
 *
 * Pro で解放されるもの：
 *   1) 1D/2D の追加フォーマット（Code39 / Code39 C.D / Code93 / ITF / Codabar / UPC-E / DataMatrix）
 *   2) 「全件保存」（PNG 一括 / ZIP エクスポート）
 *   3) ヘッダーの Pro 誘導バッジが「✓ Pro」表示に変わる（誘導が消える）
 * ゲーム「コードバトル」は全機能を無料開放（集客・継続の中心なので制限しない）。
 */
(function () {
  "use strict";

  // ==== 設定 ====================================================================
  var PRODUCT_ID = "com.kokisagawa.barcodetool.pro"; // ← App Store Connect の商品IDと一致させる
  var EULA_URL = "https://www.apple.com/legal/internet-services/itunes/dev/stdeula/";
  var PRIVACY_URL = "https://kokisagawa.github.io/barcodetool/privacy.html"; // ← 自分でホストした URL に差し替える
  var FREE_TYPES = ["code128", "ean13", "ean8", "upca", "qr"];
  var PRO_TYPES = ["code39", "code39c", "code93", "itf", "codabar", "upce", "datamatrix"];
  var LS_HINT = "bt_pro_owned";
  // ============================================================================

  var Cap = window.Capacitor;
  var isNative = !!(Cap && typeof Cap.isNativePlatform === "function" && Cap.isNativePlatform());
  var Pro = (Cap && Cap.Plugins && Cap.Plugins.Pro) || null;

  var state = {
    owned: (function () { try { return localStorage.getItem(LS_HINT) === "1"; } catch (e) { return false; } })(),
    price: "",
    ready: false,
  };
  var subs = [];

  function isPro() { return !!state.owned; }
  function setOwned(v) {
    state.owned = !!v;
    try { localStorage.setItem(LS_HINT, state.owned ? "1" : "0"); } catch (e) {}
    emit();
  }
  function emit() {
    applyGating();
    subs.forEach(function (f) { try { f(state); } catch (e) {} });
  }

  // ==== ネイティブ課金ブリッジ ==================================================
  async function refreshStatus() {
    if (isNative && Pro) {
      try {
        var s = await Pro.getStatus();
        if (s && typeof s.owned !== "undefined") {
          if (s.price) state.price = s.price;
          setOwned(s.owned);
        }
      } catch (e) {}
    }
    state.ready = true;
    emit();
  }

  if (Pro && Pro.addListener) {
    Pro.addListener("proStatusChanged", function (s) {
      if (s && s.price) state.price = s.price;
      if (s) setOwned(s.owned);
    });
  }

  async function purchase() {
    if (!isNative || !Pro) { btToast("この環境では購入できません（実機アプリで有効）"); return; }
    var btn = document.getElementById("bt-pw-buy");
    if (btn) { btn.disabled = true; btn.textContent = "処理中…"; }
    try {
      var r = await Pro.purchase({ productId: PRODUCT_ID });
      if (r && r.owned) {
        setOwned(true);
        closePaywall();
        btToast("Pro を有効化しました。ありがとうございます！");
      } else if (r && r.pending) {
        btToast("承認待ちです。完了すると自動で有効になります");
      } else if (r && r.cancelled) {
        /* 無言 */
      } else {
        btToast("購入は完了しませんでした");
      }
    } catch (e) {
      btToast("購入に失敗しました。時間をおいて再度お試しください");
    } finally {
      if (btn) { btn.disabled = false; renderPrice(); }
    }
  }

  async function restore() {
    if (!isNative || !Pro) { btToast("この環境では復元できません"); return; }
    var btn = document.getElementById("bt-pw-restore");
    if (btn) { btn.disabled = true; btn.textContent = "確認中…"; }
    try {
      var r = await Pro.restore();
      setOwned(r && r.owned);
      btToast(isPro() ? "購入を復元しました" : "復元できる購入はありませんでした");
      if (isPro()) closePaywall();
    } catch (e) {
      btToast("復元に失敗しました");
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = "購入を復元"; }
    }
  }

  // ==== トースト（アプリ内関数に依存しない自前実装）============================
  var toastTimer = null;
  function btToast(msg) {
    var el = document.getElementById("bt-toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "bt-toast";
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove("show"); }, 2600);
  }

  // ==== ペイウォール UI =========================================================
  function buildPaywall() {
    if (document.getElementById("bt-paywall")) return;
    var wrap = document.createElement("div");
    wrap.id = "bt-paywall";
    wrap.innerHTML = [
      '<div class="bt-pw-card" role="dialog" aria-modal="true" aria-label="バーコードツール Pro">',
      '  <div class="bt-pw-title">✦ バーコードツール Pro</div>',
      '  <div class="bt-pw-sub">買い切り・1回の購入で永続。サブスクではありません。</div>',
      '  <ul class="bt-pw-list">',
      "    <li>追加フォーマット：Code39 / Code39(C/D) / Code93 / ITF・ITF-14 / NW-7(Codabar) / UPC-E / DataMatrix</li>",
      "    <li>「全件保存」：複数バーコードを PNG 一括・ZIP でまとめて書き出し</li>",
      "    <li>今後追加される Pro 機能もすべて対象</li>",
      "    <li>読み取り・QR / 主要バーコード生成・コードバトルは無料のまま</li>",
      "  </ul>",
      '  <div class="bt-pw-price" id="bt-pw-price">—</div>',
      '  <button class="bt-pw-btn primary" id="bt-pw-buy">購入する</button>',
      '  <button class="bt-pw-btn ghost" id="bt-pw-restore">購入を復元</button>',
      '  <button class="bt-pw-btn ghost" id="bt-pw-close">閉じる</button>',
      '  <div class="bt-pw-legal">',
      '    購入は Apple ID に請求され、確認画面で確定します。<br>',
      '    <a href="' + EULA_URL + '" target="_blank" rel="noopener">利用規約(EULA)</a> ・ ',
      '    <a href="' + PRIVACY_URL + '" target="_blank" rel="noopener">プライバシーポリシー</a>',
      "  </div>",
      "</div>",
    ].join("\n");
    document.body.appendChild(wrap);

    wrap.addEventListener("click", function (e) { if (e.target === wrap) closePaywall(); });
    document.getElementById("bt-pw-close").addEventListener("click", closePaywall);
    document.getElementById("bt-pw-buy").addEventListener("click", purchase);
    document.getElementById("bt-pw-restore").addEventListener("click", restore);
    // 外部リンクは iOS では Safari で開く
    wrap.querySelectorAll(".bt-pw-legal a").forEach(function (a) {
      a.addEventListener("click", function (e) {
        if (isNative) { e.preventDefault(); window.open(a.href, "_system"); }
      });
    });
    renderPrice();
  }

  function renderPrice() {
    var el = document.getElementById("bt-pw-price");
    if (el) el.innerHTML = (state.price ? state.price : "価格を取得中…") + "<small>買い切り / 1回のみ</small>";
    var buy = document.getElementById("bt-pw-buy");
    if (buy) buy.textContent = state.price ? (state.price + " で購入") : "購入する";
  }

  function openPaywall(reason) {
    buildPaywall();
    renderPrice();
    var el = document.getElementById("bt-paywall");
    el.classList.add("open");
    if (isNative) refreshStatus();
  }
  function closePaywall() {
    var el = document.getElementById("bt-paywall");
    if (el) el.classList.remove("open");
  }
  window.BTPro = { isPro: isPro, open: openPaywall, purchase: purchase, restore: restore, onChange: function (f) { subs.push(f); } };

  // ==== ヘッダーの Pro バッジ ===================================================
  function ensureBadges() {
    ["gen-controls", "dec-controls", "game-controls"].forEach(function (id) {
      var host = document.getElementById(id);
      if (!host || host.querySelector(".bt-pro-badge")) return;
      var b = document.createElement("button");
      b.type = "button";
      b.className = "bt-pro-badge";
      b.addEventListener("click", function () {
        if (isPro()) return;
        openPaywall("badge");
      });
      host.insertBefore(b, host.firstChild);
    });
    updateBadges();
  }
  function updateBadges() {
    document.querySelectorAll(".bt-pro-badge").forEach(function (b) {
      if (isPro()) { b.textContent = "✓ Pro"; b.classList.add("is-owned"); }
      else { b.textContent = "✦ Pro"; b.classList.remove("is-owned"); }
    });
  }

  // ==== ゲーティング本体 ========================================================
  function applyGating() {
    document.body.classList.toggle("bt-pro", isPro());
    updateBadges();
  }

  // フォーマット選択（カスタムドロップダウンの .dd-item / 生の <select> 両方を捕捉）
  document.addEventListener(
    "click",
    function (e) {
      var t = e.target;
      if (!t || !t.closest) return;

      var item = t.closest(".dd-item");
      if (item && PRO_TYPES.indexOf(item.dataset.value) !== -1 && !isPro()) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        openPaywall("format");
        return;
      }

      var exp = t.closest("#btn-export-all");
      if (exp && !isPro()) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        openPaywall("bulk");
      }
    },
    true
  );

  // 保存状態の復元などで <select> が直接 Pro フォーマットになった場合は code128 に戻す
  document.addEventListener(
    "change",
    function (e) {
      var s = e.target;
      if (!s || s.tagName !== "SELECT") return;
      var isTypeSel = s.id === "global-type" || (s.classList && s.classList.contains("barcode-type"));
      if (isTypeSel && PRO_TYPES.indexOf(s.value) !== -1 && !isPro()) {
        s.value = "code128";
        if (typeof s._ddSync === "function") s._ddSync();
        s.dispatchEvent(new Event("input", { bubbles: true }));
        openPaywall("format");
      }
    },
    true
  );

  // ==== 起動 ===================================================================
  function boot() {
    ensureBadges();
    applyGating();
    refreshStatus();
    // アプリ側が後からヘッダーを描き替えるケースに備えて一度だけ再確認
    setTimeout(ensureBadges, 1500);
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
