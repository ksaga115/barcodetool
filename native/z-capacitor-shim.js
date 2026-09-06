/* native/z-capacitor-shim.js
 * <head> で読み込む。アプリ本体スクリプトより前に走らせて、以下を差し替える：
 *   - <a download> クリック → iOS 共有シート（Filesystem + Share）
 *   - localStorage の重要キー → ネイティブ Preferences へミラー＆起動時リストア
 *   - 画像クリップボード write 失敗時 → 共有シートにフォールバック
 *   - セーフエリア用の body クラス付与、ステータスバー設定
 * Web（Capacitor 非ネイティブ）では全て no-op。
 */
(function () {
  "use strict";

  var Cap = window.Capacitor;
  var isNative = !!(Cap && typeof Cap.isNativePlatform === "function" && Cap.isNativePlatform());
  window.__BT_NATIVE__ = isNative;
  if (!isNative) return;

  var P = (Cap && Cap.Plugins) || {};
  var MIRROR_KEYS = ["barcode_codebeast_v1", "barcode_generator_presets", "barcode_generator_state"];
  var _setItem = Storage.prototype.setItem;

  // ── body クラス（CSS のセーフエリア調整用）───────────────────────
  function markBody() {
    if (document.body) document.body.classList.add("bt-native");
    else document.addEventListener("DOMContentLoaded", markBody, { once: true });
  }
  markBody();

  // ── ステータスバー / キーボード ──────────────────────────────────
  try {
    if (P.StatusBar) {
      P.StatusBar.setStyle({ style: "LIGHT" }).catch(function () {}); // 暗い背景 → 明るい文字
      P.StatusBar.setOverlaysWebView({ overlay: true }).catch(function () {});
    }
  } catch (e) {}

  // ── <a download> を共有シートへ ────────────────────────────────
  function blobToBase64(blob) {
    return new Promise(function (res, rej) {
      var fr = new FileReader();
      fr.onerror = function () { rej(fr.error); };
      fr.onload = function () {
        var s = String(fr.result || "");
        var i = s.indexOf(",");
        res(i >= 0 ? s.slice(i + 1) : s);
      };
      fr.readAsDataURL(blob);
    });
  }

  async function saveOrShare(href, filename) {
    if (!P.Filesystem || !P.Share) return;
    var name = (filename || ("barcode_" + Date.now() + ".png")).replace(/[/\\:*?"<>|]+/g, "_");
    var base64;
    var mime = "application/octet-stream";

    if (href.indexOf("data:") === 0) {
      var head = href.slice(5, href.indexOf(","));
      mime = head.split(";")[0] || mime;
      var raw = href.slice(href.indexOf(",") + 1);
      base64 = head.indexOf("base64") >= 0 ? raw : btoa(unescape(raw));
    } else {
      var blob = await (await fetch(href)).blob();
      mime = blob.type || mime;
      base64 = await blobToBase64(blob);
    }

    await P.Filesystem.writeFile({ path: name, data: base64, directory: "CACHE" });
    var uri = (await P.Filesystem.getUri({ path: name, directory: "CACHE" })).uri;
    try {
      await P.Share.share({ title: name, url: uri, dialogTitle: "保存 / 共有" });
    } catch (e) { /* ユーザーがキャンセル */ }
  }

  var _click = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    try {
      if (this.hasAttribute("download") && this.href && /^(blob:|data:)/i.test(this.href)) {
        saveOrShare(this.href, this.getAttribute("download"));
        return;
      }
    } catch (e) {}
    return _click.apply(this, arguments);
  };

  // ── 画像クリップボード write 失敗時のフォールバック ───────────────
  if (navigator.clipboard && navigator.clipboard.write) {
    var _cw = navigator.clipboard.write.bind(navigator.clipboard);
    navigator.clipboard.write = function (items) {
      return _cw(items).catch(async function (err) {
        try {
          for (var i = 0; i < items.length; i++) {
            var item = items[i];
            var types = item.types || [];
            for (var t = 0; t < types.length; t++) {
              if (types[t].indexOf("image/") === 0) {
                var blob = await item.getType(types[t]);
                var b64 = await blobToBase64(blob);
                var ext = types[t].split("/")[1] || "png";
                var nm = "barcode_" + Date.now() + "." + ext;
                await P.Filesystem.writeFile({ path: nm, data: b64, directory: "CACHE" });
                var uri = (await P.Filesystem.getUri({ path: nm, directory: "CACHE" })).uri;
                await P.Share.share({ title: nm, url: uri, dialogTitle: "画像を共有" });
                return;
              }
            }
          }
        } catch (e) {}
        throw err;
      });
    };
  }

  // ── localStorage ミラー（ネイティブ Preferences）─────────────────
  Storage.prototype.setItem = function (k, v) {
    _setItem.call(this, k, v);
    try {
      if (this === window.localStorage && MIRROR_KEYS.indexOf(k) !== -1 && P.Preferences) {
        P.Preferences.set({ key: "ls::" + k, value: String(v) }).catch(function () {});
      }
    } catch (e) {}
  };

  // 起動時リストア：localStorage に無く、Preferences にだけ在るキーを埋め戻す。
  // （OS のストレージ退避後の復旧用。1 セッション 1 回だけ reload する）
  if (P.Preferences && !sessionStorage.getItem("bt_restore_done")) {
    (async function () {
      var restored = false;
      try {
        for (var i = 0; i < MIRROR_KEYS.length; i++) {
          var k = MIRROR_KEYS[i];
          if (window.localStorage.getItem(k) == null) {
            var r = await P.Preferences.get({ key: "ls::" + k });
            if (r && r.value != null) {
              _setItem.call(window.localStorage, k, r.value);
              restored = true;
            }
          }
        }
      } catch (e) {}
      try { sessionStorage.setItem("bt_restore_done", "1"); } catch (e) {}
      if (restored) location.reload();
    })();
  }
})();
