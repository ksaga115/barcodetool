// scripts/simlib.mjs — jsdom で BarcodeTool.html のゲーム部分だけを読み込む共通ローダ
import fs from "node:fs";
import { JSDOM, VirtualConsole } from "jsdom";

const SRC = "C:/Tools/BarcodeTool/BarcodeTool.html";

export function loadGame(opts = {}) {
  let html = fs.readFileSync(SRC, "utf8");
  html = html.replace(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g, (m, body) =>
    (body.includes("const CB = (function () {") || body.includes("BACKUP_KEYS")) ? m : "<script></script>"
  );
  html = html.replace(/<\/head>/i, `
<script>
  window.showToast=function(){};window.switchView=function(){};window.addRow=function(){};
  window.verifyGenerated=function(){};window.confirm=function(){return true;};window.alert=function(){};
  try { window.location.reload = function(){}; } catch (e) {}
  if (!window.URL.createObjectURL) window.URL.createObjectURL = function(){ return "blob:stub"; };
  if (!window.URL.revokeObjectURL) window.URL.revokeObjectURL = function(){};
  if(!window.Element.prototype.scrollIntoView)window.Element.prototype.scrollIntoView=function(){};
</script></head>`);

  const BENIGN_JSDOM_ERROR = /navigation to another Document|Not implemented: HTMLCanvasElement/;
  const errors = [];
  const vc = new VirtualConsole();
  vc.on("jsdomError", (e) => {
    const msg = String((e && (e.stack || e.message)) || e);
    if (BENIGN_JSDOM_ERROR.test(msg)) return;
    errors.push("jsdomError: " + msg);
  });

  const dom = new JSDOM(html, {
    url: "http://localhost/",
    runScripts: "dangerously",
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(window) {
      if (opts.localStorage) {
        for (const [k, v] of Object.entries(opts.localStorage)) {
          try { window.localStorage.setItem(k, v); } catch (e) {}
        }
      }
    },
  });
  const T = dom.window.CodeBeast && dom.window.CodeBeast.__test;
  return { dom, window: dom.window, doc: dom.window.document, T, CB: T && T.CB, errors };
}

// 決定論的な擬似コード生成（seed から）
export function makeGen(seed) {
  let s = seed >>> 0;
  const rnd = () => {
    s = (s + 0x9e3779b9) | 0;
    let t = s ^ (s >>> 16); t = Math.imul(t, 0x21f0aaad);
    t = t ^ (t >>> 15); t = Math.imul(t, 0x735a2d97);
    return ((t ^ (t >>> 15)) >>> 0) / 4294967296;
  };
  return {
    rnd,
    code() {
      const n = 6 + ((rnd() * 20) | 0);
      let out = "";
      for (let i = 0; i < n; i++) out += String.fromCharCode(48 + ((rnd() * 42) | 0));
      return out;
    },
    digits(n) { let o = ""; for (let i = 0; i < n; i++) o += (rnd() * 10) | 0; return o; },
    pick(arr) { return arr[(rnd() * arr.length) | 0]; },
  };
}
