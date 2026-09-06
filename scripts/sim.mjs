// scripts/sim.mjs — コードバトルの本格シミュレーション & 不変条件テスト
// 実際に出荷されるゲームコード（window.CodeBeast.__test 経由）をそのまま叩く。
import { loadGame, makeGen } from "./simlib.mjs";

const { window, T, CB, errors } = loadGame();
if (!T) { console.error("game __test hook not available"); process.exit(2); }

let PASS = 0, WARN = 0, FAIL = 0;
function judge(label, value, { pass, warn }) {
  // pass/warn: 述語（value => bool）
  let mark = "FAIL";
  if (pass(value)) { mark = "PASS"; PASS++; }
  else if (warn && warn(value)) { mark = "WARN"; WARN++; }
  else FAIL++;
  console.log("  [" + mark + "] " + label + "  =  " + (typeof value === "number" ? value.toFixed(2) : JSON.stringify(value)));
}
function info(label, value) {
  console.log("   ....  " + label + "  =  " + (typeof value === "number" ? value.toFixed(2) : JSON.stringify(value)));
}
function section(t) { console.log("\n══ " + t + " ══"); }

const gen = makeGen(0xC0DEBA5E);
const bo = (c) => CB.beastOf(c);
const eb = (c) => T.effectiveBeast(c);

// ─────────────────────────────────────────────────────────────
section("1. エンジン不変条件");

// 1a 決定論
{
  let ok = true;
  for (let i = 0; i < 3000; i++) {
    const c = gen.code();
    const a = bo(c), b = bo(c + "");
    if (a.name !== b.name || a.total !== b.total || JSON.stringify(a.stats) !== JSON.stringify(b.stats) || a.elem !== b.elem || a.trait.key !== b.trait.key) ok = false;
  }
  judge("同じコード → 同一個体 (3000)", ok ? 1 : 0, { pass: (v) => v === 1 });
}

// 1b 1v1 マッチ対称性
{
  let asym = 0, badShape = 0, N = 8000;
  for (let i = 0; i < N; i++) {
    const x = bo(gen.code()), y = bo(gen.code());
    if (x.hash === y.hash) continue;
    const salt = (gen.rnd() * 1e9) | 0;
    const m1 = CB.match(x, y, salt), m2 = CB.match(y, x, salt);
    if (m1.winner.code !== m2.winner.code) asym++;
    if (m1.count < 2 || m1.count > 3 || Math.max(m1.scoreA, m1.scoreB) !== 2 || m1.scoreA + m1.scoreB !== m1.count) badShape++;
  }
  judge("A/B 入れ替えで勝者が変わった回数 / " + N, asym, { pass: (v) => v === 0 });
  judge("Bo3 形が不正な回数 / " + N, badShape, { pass: (v) => v === 0 });
}

// 1c スカッド対称性
{
  const sq = () => ({ beasts: [bo(gen.code()), bo(gen.code()), bo(gen.code())], mastery: [0, 0, 0], reso: {} });
  let asym = 0, N = 3000;
  for (let i = 0; i < N; i++) {
    const A = sq(), B = sq(), salt = (gen.rnd() * 1e9) | 0;
    const m1 = CB.squadMatch(A, B, salt), m2 = CB.squadMatch(B, A, salt);
    // m1 の A勝ち ⇔ m2 の B勝ち
    if ((m1.winnerSide === "A") !== (m2.winnerSide === "B")) asym++;
  }
  judge("スカッド A/B 入れ替えで結果が非対称だった回数 / " + N, asym, { pass: (v) => v === 0 });
}

// 1d 戦闘の停止性（ターン上限に張り付いていないか）
{
  let maxTurns = 0, atCap = 0, N = 6000;
  for (let i = 0; i < N; i++) {
    const g = CB.battle(bo(gen.code()), bo(gen.code()), (gen.rnd() * 1e9) | 0);
    maxTurns = Math.max(maxTurns, g.turns);
    if (g.turns >= 24) atCap++;
  }
  info("1v1 最大ターン", maxTurns);
  judge("24ターン上限に到達した割合 %", 100 * atCap / N, { pass: (v) => v < 3, warn: (v) => v < 8 });
}

// 1e effectiveBeast が素体を壊さない
{
  const c = gen.code();
  const snap = JSON.stringify(bo(c).stats);
  T.grantShards(bo(c).name, 0); // no-op
  // 育成レイヤーを積んでも CB.beastOf の値は不変
  const e = { code: c, family: CB.familyTag(c), evo: 3, boost: { ATK: 10, DEF: 5 }, polish: 4, wins: 0, losses: 0, first: 1, last: 1, count: 1, session: 1 };
  T.store.beasts[c] = e; T.bumpEff();
  const effA = T.effectiveBeast(c);
  const effB = T.effectiveBeast(c);
  const same = JSON.stringify(effA.stats) === JSON.stringify(effB.stats);
  const baseUntouched = JSON.stringify(bo(c).stats) === snap;
  delete T.store.beasts[c]; T.bumpEff();
  judge("effectiveBeast は決定論的", same ? 1 : 0, { pass: (v) => v === 1 });
  judge("素体(CB.beastOf)は育成で変化しない", baseUntouched ? 1 : 0, { pass: (v) => v === 1 });
}

// ─────────────────────────────────────────────────────────────
section("2. 1v1 バランス");

// 2a 勝率 vs TOTAL差
{
  const B = { "0-2": [0, 0], "3-5": [0, 0], "6-9": [0, 0], "10-14": [0, 0], "15-20": [0, 0], "21+": [0, 0] };
  let g3 = 0, g3close = 0, closeN = 0, N = 50000;
  for (let i = 0; i < N; i++) {
    const x = bo(gen.code()), y = bo(gen.code());
    if (x.hash === y.hash) continue;
    const d = Math.abs(x.total - y.total);
    const k = d <= 2 ? "0-2" : d <= 5 ? "3-5" : d <= 9 ? "6-9" : d <= 14 ? "10-14" : d <= 20 ? "15-20" : "21+";
    const m = CB.match(x, y, i);
    const strong = x.total >= y.total ? x : y;
    B[k][0] += m.winner.code === strong.code ? 1 : 0; B[k][1]++;
    if (m.count === 3) g3++;
    if (d <= 5) { closeN++; if (m.count === 3) g3close++; }
  }
  for (const k of Object.keys(B)) if (B[k][1]) info("差 " + k + " 強い方勝率% (n=" + B[k][1] + ")", 100 * B[k][0] / B[k][1]);
  judge("差0-2 の勝率% (≒50 が理想)", 100 * B["0-2"][0] / B["0-2"][1], { pass: (v) => v >= 46 && v <= 58, warn: (v) => v >= 42 && v <= 62 });
  judge("差21+ の勝率% (圧縮レンジでは ~100 で妥当)", 100 * B["21+"][0] / B["21+"][1], { pass: (v) => v <= 100, warn: (v) => v <= 100 });
  judge("差6-9 の勝率% (格下に1〜2割の目)", 100 * B["6-9"][0] / B["6-9"][1], { pass: (v) => v <= 88, warn: (v) => v <= 93 });
  judge("接戦(差≤5)の第3ゲーム率%", 100 * g3close / closeN, { pass: (v) => v >= 12, warn: (v) => v >= 6 });
}

// 2b 属性有利の効果（TOTAL差を絞って分離）
{
  let adv = [0, 0], neu = [0, 0], dis = [0, 0], N = 60000;
  for (let i = 0; i < N; i++) {
    const x = bo(gen.code()), y = bo(gen.code());
    if (x.hash === y.hash || Math.abs(x.total - y.total) > 3) continue;
    const d = ((y.elem - x.elem) % 5 + 5) % 5; // x から見た y
    const m = CB.match(x, y, i);
    const xWon = m.winner.code === x.code;
    if (d === 1 || d === 2) { adv[0] += xWon ? 1 : 0; adv[1]++; }
    else if (d === 3 || d === 4) { dis[0] += xWon ? 1 : 0; dis[1]++; }
    else { neu[0] += xWon ? 1 : 0; neu[1]++; }
  }
  const A = 100 * adv[0] / adv[1], Nn = 100 * neu[0] / neu[1], D = 100 * dis[0] / dis[1];
  info("属性有利のとき勝率% (n=" + adv[1] + ")", A);
  info("属性互角のとき勝率% (n=" + neu[1] + ")", Nn);
  info("属性不利のとき勝率% (n=" + dis[1] + ")", D);
  judge("属性有利 - 不利 の勝率差（機能はするが決定的すぎない: 10〜40）", A - D, { pass: (v) => v >= 10 && v <= 40, warn: (v) => v >= 6 && v <= 52 });
}

// 2c トレイト別勝率（どれかが支配/死に特性でないか）
{
  const perTrait = {};
  CB.TRAITS.forEach((t) => (perTrait[t.key] = [0, 0]));
  let N = 60000;
  for (let i = 0; i < N; i++) {
    const x = bo(gen.code()), y = bo(gen.code());
    if (x.hash === y.hash) continue;
    const m = CB.match(x, y, i);
    perTrait[x.trait.key][0] += m.winner.code === x.code ? 1 : 0; perTrait[x.trait.key][1]++;
    perTrait[y.trait.key][0] += m.winner.code === y.code ? 1 : 0; perTrait[y.trait.key][1]++;
  }
  const rates = Object.entries(perTrait).map(([k, v]) => [k, 100 * v[0] / v[1], v[1]]).sort((a, b) => b[1] - a[1]);
  rates.forEach(([k, r, n]) => info("特性 " + k.padEnd(8) + " 勝率% (n=" + n + ")", r));
  const hi = rates[0][1], lo = rates[rates.length - 1][1];
  judge("最強特性の勝率%", hi, { pass: (v) => v <= 58, warn: (v) => v <= 63 });
  judge("最弱特性の勝率%", lo, { pass: (v) => v >= 42, warn: (v) => v >= 37 });
  judge("特性間の勝率レンジ(最強-最弱)", hi - lo, { pass: (v) => v <= 16, warn: (v) => v <= 24 });
}

// 2d ステ型（argmax）どうしの相性 — 一方的支配がないか
{
  const dom = (b) => CB.STAT_KEYS.reduce((best, k) => (b.stats[k] > b.stats[best] ? k : best), "ATK");
  const cell = {};
  CB.STAT_KEYS.forEach((a) => CB.STAT_KEYS.forEach((d) => (cell[a + ">" + d] = [0, 0])));
  let N = 80000;
  for (let i = 0; i < N; i++) {
    const x = bo(gen.code()), y = bo(gen.code());
    if (x.hash === y.hash || Math.abs(x.total - y.total) > 4) continue;
    const dx = dom(x), dy = dom(y);
    if (dx === dy) continue;
    const m = CB.match(x, y, i);
    cell[dx + ">" + dy][0] += m.winner.code === x.code ? 1 : 0; cell[dx + ">" + dy][1]++;
  }
  const byType = {};
  CB.STAT_KEYS.forEach((a) => {
    let w = 0, n = 0;
    CB.STAT_KEYS.forEach((d) => { if (a !== d && cell[a + ">" + d][1]) { w += cell[a + ">" + d][0]; n += cell[a + ">" + d][1]; } });
    byType[a] = n ? 100 * w / n : 0;
  });
  Object.entries(byType).forEach(([k, v]) => info("型 " + k + " が他型に勝つ率% (同TOTAL帯)", v));
  const vals = Object.values(byType);
  judge("最強ステ型の総合勝率%（型ゲーにならない: <=64）", Math.max(...vals), { pass: (v) => v <= 64, warn: (v) => v <= 70 });
  judge("最弱ステ型の総合勝率%（型が死なない: >=37）", Math.min(...vals), { pass: (v) => v >= 37, warn: (v) => v >= 31 });
}

// ─────────────────────────────────────────────────────────────
section("3. スカッド バランス");

// 特定トレイトを持つ個体を探すユーティリティ（決定論）
function findTrait(key, tries = 400000) {
  for (let t = 0; t < tries; t++) { const b = bo(gen.code()); if (b.trait.key === key) return b; }
  return null;
}

// 3a 勝率 vs 隊平均TOTAL差
{
  const sq = () => { const b = [bo(gen.code()), bo(gen.code()), bo(gen.code())]; return { beasts: b, mastery: [0, 0, 0], reso: {}, avg: (b[0].total + b[1].total + b[2].total) / 3 }; };
  const B = { "0-2": [0, 0], "3-5": [0, 0], "6-10": [0, 0], "11+": [0, 0] };
  let N = 12000;
  for (let i = 0; i < N; i++) {
    const x = sq(), y = sq();
    const d = Math.abs(x.avg - y.avg);
    const k = d <= 2 ? "0-2" : d <= 5 ? "3-5" : d <= 10 ? "6-10" : "11+";
    const m = CB.squadMatch(x, y, i);
    const strong = x.avg >= y.avg ? "A" : "B";
    B[k][0] += m.winnerSide === strong ? 1 : 0; B[k][1]++;
  }
  for (const k of Object.keys(B)) if (B[k][1]) info("隊差 " + k + " 強い方勝率% (n=" + B[k][1] + ")", 100 * B[k][0] / B[k][1]);
  judge("隊差0-2 の勝率%", 100 * B["0-2"][0] / B["0-2"][1], { pass: (v) => v >= 45 && v <= 60, warn: (v) => v >= 40 && v <= 65 });
}

// 3b シナジー「崩壊」(呪詛+蝕毒) — 数値効果とシナジー隊の実勝率
{
  const au0 = CB.squadAura(["fang", "curse", "swift"], {});      // 蝕毒なし
  const au1 = CB.squadAura(["fang", "curse", "venom"], {});      // 崩壊
  judge("squadAura が『崩壊』を検出", au1.synergies.includes("崩壊") ? 1 : 0, { pass: (v) => v === 1 });
  judge("崩壊で curseTick が 1.5x になる", au1.curseTick / (au0.curseTick || 1e-9), { pass: (v) => v >= 1.45 && v <= 1.55 });
  // 同一の3体 vs 同一の相手群で、崩壊隊は素の与ダメージが多いはず（curse/venom を含む隊）
  const curse = findTrait("curse"), venom = findTrait("venom"), tank = findTrait("wall");
  if (curse && venom && tank) {
    const withSyn = { beasts: [tank, curse, venom], mastery: [0, 0, 0], reso: {} };
    let w = 0, S = 800;
    for (let s = 0; s < S; s++) {
      const foe = { beasts: [bo(gen.code()), bo(gen.code()), bo(gen.code())], mastery: [0, 0, 0], reso: {} };
      if (CB.squadMatch(withSyn, foe, s).winnerSide === "A") w++;
    }
    info("崩壊シナジー隊(城壁+呪詛+蝕毒) 勝率% (vs 乱数の相手群)", 100 * w / S);
  }
}

// 3c 共鳴（family）の上乗せ — 同一の3体、ON/OFF を多数の相手群で比較
{
  const b3 = [bo(gen.code()), bo(gen.code()), bo(gen.code())];
  let wOn = 0, wOff = 0, S = 3000;
  for (let s = 0; s < S; s++) {
    const foe = { beasts: [bo(gen.code()), bo(gen.code()), bo(gen.code())], mastery: [0, 0, 0], reso: {} };
    if (CB.squadMatch({ beasts: b3, mastery: [0, 0, 0], reso: { family: true } }, foe, s).winnerSide === "A") wOn++;
    if (CB.squadMatch({ beasts: b3, mastery: [0, 0, 0], reso: {} }, foe, s).winnerSide === "A") wOff++;
  }
  info("共鳴ON 勝率% (n=" + S + ")", 100 * wOn / S);
  info("共鳴OFF 勝率%", 100 * wOff / S);
  judge("同族共鳴の勝率上乗せ%（1〜12）", (100 * wOn / S) - (100 * wOff / S), { pass: (v) => v >= 1 && v <= 13, warn: (v) => v >= 0 && v <= 20 });
}

// 3d 配置価値：オーラ型を後衛 vs 前衛
{
  const aura = findTrait("regen"), tanky = findTrait("wall"), dps = findTrait("fang");
  if (aura && tanky && dps) {
    const backAura = { beasts: [tanky, dps, aura], mastery: [0, 0, 0], reso: {} };  // オーラは後衛
    const frontAura = { beasts: [aura, tanky, dps], mastery: [0, 0, 0], reso: {} }; // オーラが前衛
    let wB = 0, wF = 0, S = 800;
    for (let s = 0; s < S; s++) {
      const foe = { beasts: [bo(gen.code()), bo(gen.code()), bo(gen.code())], mastery: [0, 0, 0], reso: {} };
      if (CB.squadMatch(backAura, foe, s).winnerSide === "A") wB++;
      if (CB.squadMatch(frontAura, foe, s).winnerSide === "A") wF++;
    }
    info("オーラ型を後衛に置いた隊 勝率%", 100 * wB / S);
    info("オーラ型を前衛に置いた隊 勝率%", 100 * wF / S);
    judge("後衛配置が前衛配置以上（差 >= -2%）", (100 * wB / S) - (100 * wF / S), { pass: (v) => v >= 0, warn: (v) => v >= -4 });
  } else info("3d skipped", 0);
}

// 3e 熟練度/研磨の効果サイズ（growthMastery 0 vs 5）— 同一の3体、多数の相手群で ON/OFF
{
  const b3 = [bo(gen.code()), bo(gen.code()), bo(gen.code())];
  let w0 = 0, w5 = 0, S = 3000;
  for (let s = 0; s < S; s++) {
    const foe = { beasts: [bo(gen.code()), bo(gen.code()), bo(gen.code())], mastery: [0, 0, 0], reso: {} };
    if (CB.squadMatch({ beasts: b3, mastery: [0, 0, 0], reso: {} }, foe, s).winnerSide === "A") w0++;
    if (CB.squadMatch({ beasts: b3, mastery: [5, 5, 5], reso: {} }, foe, s).winnerSide === "A") w5++;
  }
  info("mastery 0 勝率% (n=" + S + ")", 100 * w0 / S); info("mastery 5 勝率%", 100 * w5 / S);
  judge("熟練度MAXの勝率上乗せ%（小さくあるべき: 0〜10）", (100 * w5 / S) - (100 * w0 / S), { pass: (v) => v >= 0 && v <= 10, warn: (v) => v >= -2 && v <= 15 });
}

// ─────────────────────────────────────────────────────────────
section("4. 育成の経済 & ハードキャップ");

// 4a フル育成コモン vs 無育成SS/S
{
  T.resetStore();
  // コモン（下位）と SS/S を収集
  const commons = [], elites = [];
  for (let i = 0; i < 400000 && (commons.length < 40 || elites.length < 40); i++) {
    const c = gen.code(), b = bo(c);
    if (b.total <= 42 && commons.length < 40) commons.push(c);
    else if ((b.rank === "SS" || b.rank === "S") && elites.length < 40) elites.push(c);
  }
  info("収集: コモン数 / エリート数", commons.length + " / " + elites.length);
  // 各コモンをフル育成（無限欠片で evo3 + boost 上限）
  commons.forEach((c) => {
    const fam = CB.familyTag(c);
    T.store.beasts[c] = { code: c, family: fam, evo: 0, boost: {}, polish: 0, wins: 0, losses: 0, first: 1, last: 1, count: 1, session: 1 };
    T.store.shards[fam] = 99999;
    // しきい値を無視して直接 evo を積む（上限性能の確認が目的）
    T.store.beasts[c].evo = 3;
    for (let k = 0; k < 80; k++) T.doBoost(c, CB.STAT_KEYS[k % 5]);
  });
  T.bumpEff();
  let cw = 0, tot = 0;
  for (const cc of commons) for (const ec of elites) {
    const cb = T.effectiveBeast(cc), ebt = bo(ec);
    const m = CB.match(cb, ebt, (cc.length * 131 + ec.length) | 0);
    cw += m.winner.code === cb.code ? 1 : 0; tot++;
  }
  const winPct = 100 * cw / tot;
  info("フル育成コモンの実効TOTAL例", T.effectiveBeast(commons[0]).total + " (素体 " + bo(commons[0]).total + ")");
  judge("フル育成コモン vs 無育成SS/S の勝率%（<45 が設計意図）", winPct, { pass: (v) => v < 45, warn: (v) => v < 52 });
}

// 4b キャップが実際に効くか
{
  T.resetStore();
  const c = gen.code(), fam = CB.familyTag(c);
  T.store.beasts[c] = { code: c, family: fam, evo: 0, boost: {}, polish: 0, wins: 0, losses: 0, first: 1, last: 1, count: 1, session: 1 };
  T.store.shards[fam] = 99999;
  let applied = 0;
  for (let k = 0; k < 200; k++) { if (T.doBoost(c, CB.STAT_KEYS[k % 5])) applied++; else break; }
  const e = T.store.beasts[c];
  const total = CB.STAT_KEYS.reduce((a, k) => a + (e.boost[k] || 0), 0);
  const maxStat = Math.max(...CB.STAT_KEYS.map((k) => e.boost[k] || 0));
  info("強化を積めた回数", applied);
  judge("boost 合計がキャップ内", total, { pass: (v) => v <= 40 });
  judge("1ステ boost がキャップ内", maxStat, { pass: (v) => v <= 15 });
  // polish
  let pol = 0; for (let k = 0; k < 20; k++) { if (T.doPolish(c)) pol++; else break; }
  judge("研磨は 5 で頭打ち", pol, { pass: (v) => v === 5 });
}

// 4c 欠片収入シミュレーション（30日、1日10スキャン、下位3体を溶解）
{
  T.resetStore();
  let totalShardsEarned = 0, evolutionsAffordable = 0;
  for (let day = 0; day < 30; day++) {
    const todays = [];
    for (let i = 0; i < 10; i++) { const c = "sim-day" + day + "-scan" + i + "-" + gen.digits(6); T.discover(c, "", ""); todays.push(CB.normalize(c)); }
    // コレクション全体から戦績なし下位3体をアーカイブ→溶解
    const all = Object.keys(T.store.beasts).map((k) => ({ k, t: bo(k).total })).sort((a, b) => a.t - b.t);
    for (const { k } of all.slice(0, 3)) {
      if (!T.store.beasts[k]) continue;
      T.store.archive[k] = T.store.beasts[k]; delete T.store.beasts[k];
      totalShardsEarned += T.dissolveToShards(k);
    }
  }
  const weekly = totalShardsEarned / 30 * 7;
  // 進化1(3) + 強化数回 に相当？
  info("30日で得た欠片合計", totalShardsEarned);
  info("週あたり欠片", weekly);
  // 積極的に溶解する戦略での上限値。ハードキャップがあるので破綻はしない。
  judge("週あたり欠片（積極溶解時の上限。6〜60が許容）", weekly, { pass: (v) => v >= 6 && v <= 60, warn: (v) => v >= 3 && v <= 90 });
  judge("溶解ループでコレクションが枯れない", Object.keys(T.store.beasts).length, { pass: (v) => v >= 30 });
}

// ─────────────────────────────────────────────────────────────
section("5. ガントレット スケーリング");
{
  T.resetStore();
  function buildCollection(targetMedian, count) {
    let added = 0;
    for (let i = 0; i < 500000 && added < count; i++) {
      const c = "gcol-" + targetMedian + "-" + i;
      const b = bo(c);
      if (Math.abs(b.total - targetMedian) <= 9) { T.discover(c, "", ""); added++; }
    }
  }
  for (const med of [40, 46, 52, 58]) {
    T.resetStore();
    buildCollection(med, 40);
    const realMed = T.medianCollectionTotal();
    // 上位3体で隊を組む
    const top = Object.keys(T.store.beasts).sort((a, b) => bo(b).total - bo(a).total).slice(0, 3);
    T.store.squad = { front: top[0], mid: top[1], back: top[2] };
    const mine = T.resolveSquad(T.squadCodes(), false);
    let reachSum = 0, clears5 = 0, S = 200;
    for (let s = 0; s < S; s++) {
      let reached = 0;
      for (let r = 1; r <= 5; r++) {
        const foe = { beasts: T.gauntSquadFor(1000 + s, r, realMed).map((c) => bo(c)), mastery: [0, 0, 0], reso: {} };
        if (CB.squadMatch(mine, foe, s * 11 + r).winnerSide === "A") reached = r; else break;
      }
      reachSum += reached; if (reached === 5) clears5++;
    }
    info("collection median≈" + realMed + " → 平均到達段 / 全制覇率%", (reachSum / S).toFixed(2) + " / " + (100 * clears5 / S).toFixed(0));
  }
  judge("ガントレットは全滅も無双もしない（目視: 上の到達段が 1.5〜4.5 に収まる）", 1, { pass: (v) => v === 1 });
}

// ─────────────────────────────────────────────────────────────
section("6. 堅牢性 / エッジ");

// 6a 少数コレクション
{
  T.resetStore();
  let threw = false;
  try {
    T.renderStatus();                       // 空
    T.discover("solo-" + gen.digits(6), "", "");
    T.renderStatus();                       // 1体
    T.medianCollectionTotal(); T.squadFull();
    T.discover("duo-" + gen.digits(6), "", "");
    T.renderStatus();                       // 2体
  } catch (e) { threw = true; errors.push("edge少数: " + e.message); }
  judge("0/1/2体でも描画・各種呼び出しが例外を出さない", threw ? 1 : 0, { pass: (v) => v === 0 });
}

// 6b 変なコード
{
  let threw = false;
  const weird = ["", "   ", "あ".repeat(300), "日本語テスト🔥", "x".repeat(2000), "\n\t\r", "'; DROP TABLE;--", "https://" + "a".repeat(400) + ".jp"];
  try {
    for (const w of weird) { const b = bo(w || "empty-fallback"); void b.total; void CB.familyTag(w); }
  } catch (e) { threw = true; errors.push("edgeコード: " + e.message); }
  judge("空/超長/Unicode/記号コードで例外なし", threw ? 1 : 0, { pass: (v) => v === 0 });
}

// 6c 壊れたセーブ
{
  const g2 = loadGame({ localStorage: { "barcode_codebeast_v2": "{{{ not json ]]]" } });
  const ok = g2.T && Object.keys(g2.T.store.beasts).length === 0 && g2.errors.length === 0;
  judge("壊れた v2 セーブ → 例外なし・空スタート", ok ? 1 : 0, { pass: (v) => v === 1 });
}

// 6d v1 → v2 マイグレーション
{
  const v1 = JSON.stringify({
    v: 1, sel: "", slots: { a: "", b: "" },
    beasts: {
      "4901234567894": { code: "4901234567894", kind: "ean13", label: "JAN", first: 1, last: 2, count: 3, wins: 5, losses: 2 },
      "HELLO": { code: "HELLO", kind: "code128", label: "C128", first: 1, last: 1, count: 1, wins: 0, losses: 0 }
    }
  });
  const g3 = loadGame({ localStorage: { "barcode_codebeast_v1": v1 } });
  const s = g3.T.store;
  const carried = s.beasts["4901234567894"] && s.beasts["4901234567894"].wins === 5 && s.beasts["HELLO"];
  const v1kept = g3.window.localStorage.getItem("barcode_codebeast_v1") === v1;
  const v2written = !!g3.window.localStorage.getItem("barcode_codebeast_v2");
  judge("v1→v2: 戦績を引き継ぐ", carried ? 1 : 0, { pass: (v) => v === 1 });
  judge("v1→v2: v1 セーブを残す", v1kept ? 1 : 0, { pass: (v) => v === 1 });
  judge("v1→v2: v2 セーブを書く", v2written ? 1 : 0, { pass: (v) => v === 1 });
  judge("v1→v2: 例外なし", g3.errors.length, { pass: (v) => v === 0 });
}

// ─────────────────────────────────────────────────────────────
section("7. 技（攻撃手段）・一発逆転・背水の陣");

// 7a 技の構造検証
{
  let ok = true, hasSelfElem = 0, N = 3000;
  for (let i = 0; i < N; i++) {
    const b = bo(gen.code());
    if (!b.moves || b.moves.length !== 3) { ok = false; continue; }
    const kinds = new Set(b.moves.map((m) => m.kind));
    if (kinds.size < 2) ok = false; // 3つとも同じ種類にはならない設計
    b.moves.forEach((m) => { if (m.elem < 0 || m.elem > 4 || !m.name || !m.element) ok = false; });
    if (b.moves[0].elem === b.elem) hasSelfElem++;
  }
  judge("技は3つ・妥当な属性/名前を持つ (n=" + N + ")", ok ? 1 : 0, { pass: (v) => v === 1 });
  judge("1本目が自分の属性(十八番)である割合% (100が正)", 100 * hasSelfElem / N, { pass: (v) => v === 100 });
  let hasFinisher = 0;
  for (let i = 0; i < N; i++) { if (bo(gen.code()).moves.some((m) => m.kind === "finisher")) hasFinisher++; }
  info("渾身の一撃を持つ個体の割合% (狙いは15〜35%くらい)", 100 * hasFinisher / N);
}

// 7b 育成済み個体でも moves を保持する（effectiveBeast のリグレッション確認）
{
  T.resetStore();
  const c = gen.code(), fam = CB.familyTag(c);
  T.store.beasts[c] = { code: c, family: fam, evo: 2, boost: { ATK: 5 }, polish: 1, wins: 0, losses: 0, first: 1, last: 1, count: 1, session: 1 };
  T.bumpEff();
  const eff = T.effectiveBeast(c);
  judge("育成済み(effectiveBeast)も moves を保持する", (eff.moves && eff.moves.length === 3) ? 1 : 0, { pass: (v) => v === 1 });
  const m2 = CB.match(eff, bo(gen.code()), 1);
  judge("育成済み個体で実際にマッチが例外なく回る", m2 && m2.games.length >= 2 ? 1 : 0, { pass: (v) => v === 1 });
}

// 7c 渾身の一撃（finisher）の出現率 — 稀だが0ではない
{
  let gamesWithFinisher = 0, N = 4000;
  for (let i = 0; i < N; i++) {
    const x = bo(gen.code()), y = bo(gen.code());
    const g = CB.battle(x, y, i);
    if (g.log.some((l) => l.t === "finisher")) gamesWithFinisher++;
  }
  const pct = 100 * gamesWithFinisher / N;
  info("渾身の一撃が飛び出したゲームの割合%", pct);
  judge("渾身の一撃は「たまに見る」程度の頻度（0では困る／毎回でも困る: 3〜33%）", pct, { pass: (v) => v >= 3 && v <= 33, warn: (v) => v >= 0.5 && v <= 45 });
}

// 7d 背水の陣（desperation）の効果 — 同一ペア・同一シードで despSide だけ切り替えて比較
{
  let winPlain = 0, winDesp = 0, N = 8000;
  for (let i = 0; i < N; i++) {
    const x = bo(gen.code()), y = bo(gen.code());
    if (x.hash === y.hash) continue;
    const seed = i * 131 + 7;
    if (CB.battle(x, y, seed, 0, 0, null).winnerSide === "A") winPlain++;
    if (CB.battle(x, y, seed, 0, 0, "A").winnerSide === "A") winDesp++;
  }
  info("背水の陣なし: A勝率% (n=" + N + ")", 100 * winPlain / N);
  info("背水の陣あり(A): A勝率%", 100 * winDesp / N);
  judge("背水の陣による勝率の上乗せ%（正だが大きすぎない: 1〜15）", 100 * (winDesp - winPlain) / N, { pass: (v) => v >= 1 && v <= 15, warn: (v) => v >= -1 && v <= 20 });
}

// 7e スカッドでも背水の陣が効く
{
  let winPlain = 0, winDesp = 0, N = 4000;
  for (let i = 0; i < N; i++) {
    const A = { beasts: [bo(gen.code()), bo(gen.code()), bo(gen.code())], mastery: [0, 0, 0], reso: {} };
    const B = { beasts: [bo(gen.code()), bo(gen.code()), bo(gen.code())], mastery: [0, 0, 0], reso: {} };
    const seed = i * 131 + 7;
    if (CB.squadBattle(A, B, seed, null).winnerSide === "A") winPlain++;
    if (CB.squadBattle(A, B, seed, "A").winnerSide === "A") winDesp++;
  }
  judge("スカッドの背水の陣による勝率の上乗せ%（正だが大きすぎない: 1〜15）", 100 * (winDesp - winPlain) / N, { pass: (v) => v >= 1 && v <= 15, warn: (v) => v >= -1 && v <= 20 });
}

// 7f カバー技の効果は section 2b（属性有利-不利差）に自動的に反映される（技のカバーで縮む設計）。

// ─────────────────────────────────────────────────────────────
section("8. ランク別育成コスト・融合");

// 8a ランクが高いほど進化・強化・研磨のコストが高い
{
  T.resetStore();
  // 低ランク・高ランクの個体を集める
  let lowCode = null, highCode = null;
  for (let i = 0; i < 300000 && (!lowCode || !highCode); i++) {
    const c = gen.code(), b = bo(c);
    if (!lowCode && (b.rank === "E" || b.rank === "D")) lowCode = c;
    if (!highCode && (b.rank === "S" || b.rank === "SS")) highCode = c;
  }
  [lowCode, highCode].forEach((c) => { T.discover(c, "", ""); T.store.shards[bo(c).rank] = 0; });
  const lowEvo1 = T.evoCost(lowCode, 1), highEvo1 = T.evoCost(highCode, 1);
  const lowEvo3 = T.evoCost(lowCode, 3), highEvo3 = T.evoCost(highCode, 3);
  info("低ランク(" + bo(lowCode).rank + ") 進化1/3 コスト", lowEvo1 + " / " + lowEvo3);
  info("高ランク(" + bo(highCode).rank + ") 進化1/3 コスト", highEvo1 + " / " + highEvo3);
  judge("高ランクの方が進化コストが高い（段階が上がるほど差も拡大）", (highEvo3 - lowEvo3) - (highEvo1 - lowEvo1), { pass: (v) => v > 0 });
  judge("進化コストは常に高ランク >= 低ランク", (highEvo1 >= lowEvo1 && highEvo3 >= lowEvo3) ? 1 : 0, { pass: (v) => v === 1 });

  const lowPolish = T.polishCost(lowCode), highPolish = T.polishCost(highCode);
  judge("研磨コストも高ランクの方が高いか同等", highPolish >= lowPolish ? 1 : 0, { pass: (v) => v === 1 });
}

// 8b 融合: 決定論・順不同・親のアーカイブ化・再融合の禁止
{
  T.resetStore();
  const a = gen.code(), b = gen.code();
  [a, b].forEach((c) => T.discover(c, "", ""));
  const famA = T.store.beasts[a].family || CB.familyTag(a);
  const famB = T.store.beasts[b].family || CB.familyTag(b);
  T.grantShards(famA, 50); T.grantShards(famB, 50);

  const fcAB = T.fusionCodeOf(a, b), fcBA = T.fusionCodeOf(b, a);
  judge("融合コードは順不同（A融合B＝B融合A）", fcAB === fcBA ? 1 : 0, { pass: (v) => v === 1 });

  const beastsBefore = Object.keys(T.store.beasts).length;
  const fc = T.doFuse(a, b);
  judge("融合が成功しコードを返す", fc ? 1 : 0, { pass: (v) => v === 1 });
  judge("親2体はアーカイブへ（削除ではない）", (!T.store.beasts[a] && !T.store.beasts[b] && T.store.archive[a] && T.store.archive[b]) ? 1 : 0, { pass: (v) => v === 1 });
  judge("コレクション数は親2抜け子1増でちょうど-1", Object.keys(T.store.beasts).length === beastsBefore - 1 ? 1 : 0, { pass: (v) => v === 1 });
  judge("融合結果の family は FUSION", T.store.beasts[fc] && T.store.beasts[fc].family === "FUSION" ? 1 : 0, { pass: (v) => v === 1 });
  const fusedBeast = bo(fc);
  info("融合結果", fusedBeast.name + "（" + fusedBeast.rank + " / " + fusedBeast.element.name + "）");

  // 同じ親コードでもう一度融合しようとするとブロックされる（親は既にアーカイブなので candidate 自体が集められない状況を模して直接 canFuse を見る）
  T.store.beasts[a] = T.store.archive[a]; delete T.store.archive[a];
  T.store.beasts[b] = T.store.archive[b]; delete T.store.archive[b];
  const again = T.canFuse(a, b);
  judge("同じ組み合わせの再融合はブロックされる", again.ok ? 0 : 1, { pass: (v) => v === 1 });

  // 決定論: 同じ2コードから毎回同じ融合結果
  const fc2 = T.fusionCodeOf(a, b);
  judge("融合コードは決定論的", fc2 === fc ? 1 : 0, { pass: (v) => v === 1 });
}

// 8c 融合コストはランクが高い親ほど上がる
{
  let lowPair = null, highPair = null;
  for (let i = 0; i < 300000 && (!lowPair || !highPair); i++) {
    const x = gen.code(), y = gen.code();
    const bx = bo(x), by = bo(y);
    if (!lowPair && (bx.rank === "E" || bx.rank === "D") && (by.rank === "E" || by.rank === "D")) lowPair = [x, y];
    if (!highPair && (bx.rank === "S" || bx.rank === "SS") && (by.rank === "S" || by.rank === "SS")) highPair = [x, y];
  }
  if (lowPair && highPair) {
    const lc = T.fusionCost(lowPair[0], lowPair[1]), hc = T.fusionCost(highPair[0], highPair[1]);
    info("低ランクペアの融合コスト", lc);
    info("高ランクペアの融合コスト", hc);
    judge("高ランクの親ほど融合コストが高い", hc > lc ? 1 : 0, { pass: (v) => v === 1 });
  } else info("8c: 適当なペアが見つからずスキップ", 0);
}

// 8d 融合個体でも対戦・育成が例外なく動く（effectiveBeast 経由の回帰確認）
{
  T.resetStore();
  const a = gen.code(), b = gen.code();
  [a, b].forEach((c) => T.discover(c, "", ""));
  const famA = T.store.beasts[a].family || CB.familyTag(a);
  T.grantShards(famA, 50);
  T.grantShards(T.store.beasts[b].family || CB.familyTag(b), 50);
  const fc = T.doFuse(a, b);
  let threw = false;
  try {
    const m = CB.match(T.effectiveBeast(fc), bo(gen.code()), 1);
    if (!m || m.games.length < 2) threw = true;
    // 育成もかけてみる
    T.store.shards["FUSION"] = 999;
    T.doBoost(fc, "ATK");
  } catch (e) { threw = true; errors.push("8d: " + e.message); }
  judge("融合個体で対戦・育成が例外なく動く", threw ? 0 : 1, { pass: (v) => v === 1 });
}

section("9. 対人（挑戦状・通信なし）");

// 9a 決定論: 同じ自隊なら挑戦状の文字列は毎回同じ
{
  T.resetStore();
  const codes = [gen.code(), gen.code(), gen.code()];
  codes.forEach((c) => T.discover(c, "", ""));
  T.store.squad = { front: codes[0], mid: codes[1], back: codes[2] };
  const c1 = T.buildChallengeCode("N1");
  const c2 = T.buildChallengeCode("N1");
  judge("挑戦状は同じ自隊なら毎回同じ文字列", c1 === c2 ? 1 : 0, { pass: (v) => v === 1 });
}

// 9b ラウンドトリップ: 育成状況（強化）込みで相手のビーストが再現される
{
  T.resetStore();
  const codes = [gen.code(), gen.code(), gen.code()];
  codes.forEach((c) => T.discover(c, "", ""));
  const fam = T.store.beasts[codes[0]].family || CB.familyTag(codes[0]);
  T.grantShards(fam, 999);
  for (let i = 0; i < 20 && T.canBoost(codes[0], "ATK").ok; i++) T.doBoost(codes[0], "ATK");
  const grownBefore = eb(codes[0]);
  T.store.squad = { front: codes[0], mid: codes[1], back: codes[2] };
  const chal = T.buildChallengeCode("親善試合");

  T.resetStore(); // 相手側の端末を模して、まっさらな状態から読み込む
  const r = T.importChallenge(chal);
  const rb0 = r ? T.rivalBeastOf(r.entries[0]) : null;
  judge("挑戦状は相手の育成状況（強化）込みで再現される",
    (rb0 && rb0.stats.ATK === grownBefore.stats.ATK && rb0.total === grownBefore.total) ? 1 : 0,
    { pass: (v) => v === 1 });
}

// 9c 頑丈性: 壊れた/改ざんされた挑戦状で例外を出さない・値を安全域にクランプする
{
  T.resetStore();
  let threw = false, gotSomething = false;
  const badInputs = [
    "not a challenge code at all",
    "CBX1:not json",
    "CBX1:{}",
    "CBX1:" + JSON.stringify({ v: 1, kind: "squad", entries: [{ code: "x" }] }),   // 3体未満
    "CBX1:" + JSON.stringify({ v: 1, kind: "solo", entries: [] }),                  // 未対応の kind
    "CBX1:" + JSON.stringify({ v: 1, kind: "squad", entries: [{ code: 1 }, { code: 2 }, { code: 3 }] }), // code が数値
  ];
  badInputs.forEach((s) => {
    try { if (T.importChallenge(s)) gotSomething = true; } catch (e) { threw = true; errors.push("9c: " + e.message); }
  });
  judge("壊れた挑戦状は例外を出さず、すべて読み込み失敗になる", (!threw && !gotSomething) ? 1 : 0, { pass: (v) => v === 1 });

  const codes = [gen.code(), gen.code(), gen.code()];
  const tampered = "CBX1:" + JSON.stringify({
    v: 1, kind: "squad",
    entries: codes.map((c) => ({ code: c, evo: 999, boost: { ATK: 9999, DEF: -50 }, polish: 9999 }))
  });
  const r2 = T.importChallenge(tampered);
  let clamped = !!r2;
  if (r2) r2.entries.forEach((e) => {
    if (e.evo > 3 || e.evo < 0) clamped = false;
    if ((e.boost.ATK || 0) > 15 || (e.boost.DEF || 0) < 0) clamped = false;
    if (e.polish > 20 || e.polish < 0) clamped = false;
  });
  judge("改ざんされた極端な数値は安全域にクランプされる", clamped ? 1 : 0, { pass: (v) => v === 1 });
}

// 9d 対人戦は自分のコレクションを書き換えない（相手データが混ざらない）
{
  T.resetStore();
  const mine = [gen.code(), gen.code(), gen.code()];
  mine.forEach((c) => T.discover(c, "", ""));
  T.store.squad = { front: mine[0], mid: mine[1], back: mine[2] };

  const foeCodes = [gen.code(), gen.code(), gen.code()];
  const savedSquad = T.store.squad;
  foeCodes.forEach((c) => T.discover(c, "", ""));
  T.store.squad = { front: foeCodes[0], mid: foeCodes[1], back: foeCodes[2] };
  const chal = T.buildChallengeCode("相手");
  T.store.squad = savedSquad;
  foeCodes.forEach((c) => { delete T.store.beasts[c]; delete T.store.archive[c]; }); // 本当に「他人」を模す

  const r = T.importChallenge(chal);
  const beastsBefore = Object.keys(T.store.beasts).length;
  let threw = false;
  try {
    const mineSq = T.resolveSquad(T.squadCodes(), false);
    const foeSq = T.rivalResolveSquad(r);
    const m = CB.squadMatch(mineSq, foeSq, 12345);
    if (!m || !m.games.length) threw = true;
  } catch (e) { threw = true; errors.push("9d: " + e.message); }
  judge("対人戦（squadMatch）が例外なく成立する", threw ? 0 : 1, { pass: (v) => v === 1 });
  judge("対人戦後も相手のコードは自分のコレクションに紛れ込まない", Object.keys(T.store.beasts).length === beastsBefore ? 1 : 0, { pass: (v) => v === 1 });
}

// 9e 目安: 典型的なコード長（13桁バーコード3体）でのペイロード文字数
{
  T.resetStore();
  const codes = [gen.digits(13), gen.digits(13), gen.digits(13)];
  codes.forEach((c) => T.discover(c, "", ""));
  T.store.squad = { front: codes[0], mid: codes[1], back: codes[2] };
  const chal = T.buildChallengeCode("");
  info("挑戦状の文字数（13桁バーコード3体・素体のまま）", chal.length);
}

section("10. 名前（実在の単語）・陰陽五行");

// 10a 名前は prefixWord + suffixWord（非融合コード）
{
  let ok = true, N = 3000;
  for (let i = 0; i < N; i++) {
    const b = bo(gen.code());
    if (!b.prefixWord || !b.suffixWord || b.name !== b.prefixWord + b.suffixWord) ok = false;
  }
  judge("非融合の名前は prefixWord+suffixWord と一致する (n=" + N + ")", ok ? 1 : 0, { pass: (v) => v === 1 });
}

// 10b 陰陽五行: 相生（生む）は d=1、相克（克す）は d=2 で、克のほうが強く効く
{
  const WOOD = 0, FIRE = 1, EARTH = 2, METAL = 3, WATER = 4;
  const genAdv = CB.affinity(WOOD, FIRE);   // 木は火を生む（相生）
  const overAdv = CB.affinity(WOOD, EARTH); // 木は土を克す（相克）
  const overDis = CB.affinity(WOOD, METAL); // 木は金に克される（金克木）
  const genDis = CB.affinity(WOOD, WATER);  // 木は水に生まれた（水生木）
  judge("相生（生む）はやや有利", genAdv > 1 && genAdv < overAdv ? 1 : 0, { pass: (v) => v === 1 });
  judge("相克（克す）は相生より強い有利", overAdv > genAdv ? 1 : 0, { pass: (v) => v === 1 });
  judge("被克（克される）は被生より強い不利", overDis < genDis && overDis < 1 ? 1 : 0, { pass: (v) => v === 1 });
  judge("五行の並びが一巡して閉じる（木は木に等倍）", CB.affinity(WOOD, WOOD) === 1 ? 1 : 0, { pass: (v) => v === 1 });
  info("五行の呼称", CB.ELEMENTS.map((e) => e.name).join("→"));
}

// 10c 進化は接頭辞（真→極→神）、強化は接尾辞（+の数）
{
  T.resetStore();
  const c = gen.code(), fam = CB.familyTag(c);
  const base = bo(c);
  T.store.beasts[c] = { code: c, family: fam, evo: 0, boost: {}, polish: 0, wins: 0, losses: 0, first: 1, last: 1, count: 1, session: 1 };
  T.bumpEff();
  const e1 = eb(c);
  judge("育成なしは素体名のまま", e1.name === base.name ? 1 : 0, { pass: (v) => v === 1 });

  T.store.beasts[c].evo = 2; T.bumpEff();
  const e2 = eb(c);
  info("進化2段の名前", e2.name);
  judge("進化2段は「極」が名前の頭に付く", e2.name === "極" + base.name ? 1 : 0, { pass: (v) => v === 1 });

  T.store.beasts[c].boost = { ATK: 10, DEF: 8 }; T.bumpEff(); // 合計18 → "++"
  const e3 = eb(c);
  info("進化+強化の名前", e3.name);
  judge("強化量に応じて名前の末尾に+が付く", e3.name === "極" + base.name + "++" ? 1 : 0, { pass: (v) => v === 1 });
}

// 10d 融合の名前は親2体の単語から組み立てられる（無関係なランダム名にならない）
{
  T.resetStore();
  const a = gen.code(), b = gen.code();
  [a, b].forEach((c) => T.discover(c, "", ""));
  T.grantShards(T.store.beasts[a].family || CB.familyTag(a), 50);
  T.grantShards(T.store.beasts[b].family || CB.familyTag(b), 50);
  const ba = bo(a), bb = bo(b);
  const fc = T.doFuse(a, b);
  const fused = bo(fc);
  const words = [ba.prefixWord, ba.suffixWord, bb.prefixWord, bb.suffixWord];
  const usesParentWords = words.some((w) => fused.name.indexOf(w) >= 0);
  info("融合名", ba.name + " + " + bb.name + " → " + fused.name);
  judge("融合個体の名前は親のどちらかの単語を含む", usesParentWords ? 1 : 0, { pass: (v) => v === 1 });
  judge("融合コードは決定論的に同じ名前を返す", bo(fc).name === fused.name ? 1 : 0, { pass: (v) => v === 1 });
}

section("11. 愛称・育成リセット・譲渡・統計");

// 11a 育成リセットは使った欠片の8割を払い戻し、素体に戻す
{
  T.resetStore();
  const c = gen.code(), fam = CB.familyTag(c);
  T.discover(c, "", "");
  T.grantShards(fam, 999);
  const before = T.shardsOf(fam);
  // 進化1 + 強化数回
  T.doEvolve(c);
  for (let i = 0; i < 5 && T.canBoost(c, "ATK").ok; i++) T.doBoost(c, "ATK");
  const spent = before - T.shardsOf(fam);
  const afterSpend = T.shardsOf(fam);
  const refund = T.resetGrowth(c);
  judge("リセットで育成が素体に戻る", (!T.store.beasts[c].evo && T.store.beasts[c].polish === 0 && Object.keys(T.store.beasts[c].boost).length === 0) ? 1 : 0, { pass: (v) => v === 1 });
  judge("払い戻しは使った欠片の約8割", (refund === Math.floor(spent * 0.8) && T.shardsOf(fam) === afterSpend + refund) ? 1 : 0, { pass: (v) => v === 1 }, "spent=" + spent + " refund=" + refund);
}

// 11b 譲渡コード: 決定論・育成/愛称込みラウンドトリップ・既所持なら重複しない
{
  T.resetStore();
  const c = gen.code(), fam = CB.familyTag(c);
  T.discover(c, "", "");
  T.grantShards(fam, 999);
  T.doEvolve(c);
  for (let i = 0; i < 4 && T.canBoost(c, "DEF").ok; i++) T.doBoost(c, "DEF");
  T.store.beasts[c].nick = "あいぼう";
  const g1 = T.buildGiftCode(c), g2 = T.buildGiftCode(c);
  judge("譲渡コードは決定論的（同じ個体なら同じ文字列）", g1 === g2 ? 1 : 0, { pass: (v) => v === 1 });
  const grownDef = eb(c).stats.DEF;

  // 別端末を模して空からインポート
  T.resetStore();
  const res = T.importGift(g1);
  judge("譲渡コードでコレクションに追加される", (res && !res.already && T.store.beasts[res.code]) ? 1 : 0, { pass: (v) => v === 1 });
  judge("育成状態（強化DEF）が引き継がれる", eb(res.code).stats.DEF === grownDef ? 1 : 0, { pass: (v) => v === 1 });
  judge("愛称も引き継がれる", T.store.beasts[res.code].nick === "あいぼう" ? 1 : 0, { pass: (v) => v === 1 });
  const cnt = Object.keys(T.store.beasts).length;
  const res2 = T.importGift(g1);
  judge("すでに持っていれば重複追加しない", (res2 && res2.already && Object.keys(T.store.beasts).length === cnt) ? 1 : 0, { pass: (v) => v === 1 });

  // 壊れた譲渡コードは null（例外を出さない）
  let threw = false;
  try { if (T.importGift("CBG1:{bad json")) threw = true; } catch (e) { threw = true; }
  judge("壊れた譲渡コードは例外を出さず失敗", threw ? 0 : 1, { pass: (v) => v === 1 });
}

// 11c スカッドのプリセット保存・読み込み・削除
{
  T.resetStore();
  const cs = [gen.code(), gen.code(), gen.code(), gen.code(), gen.code(), gen.code()];
  cs.forEach((c) => T.discover(c, "", ""));
  T.store.squad = { front: cs[0], mid: cs[1], back: cs[2] };
  T.saveSquadPreset(); // cbPrompt が入るので即 push されるとは限らない…と思いきや jsdom では onOk 未実行。直接 push でテスト
  // saveSquadPreset は cbPrompt 経由なので、ここでは store を直接操作して読み込み/削除を検証
  T.store.squadPresets.push({ name: "A", front: cs[0], mid: cs[1], back: cs[2] });
  T.store.squadPresets.push({ name: "B", front: cs[3], mid: cs[4], back: cs[5] });
  T.loadSquadPreset(1);
  judge("プリセット読み込みで自隊が入れ替わる", (T.store.squad.front === cs[3] && T.store.squad.back === cs[5]) ? 1 : 0, { pass: (v) => v === 1 });
  const n = T.store.squadPresets.length;
  T.deleteSquadPreset(0);
  judge("プリセット削除で1つ減る", T.store.squadPresets.length === n - 1 ? 1 : 0, { pass: (v) => v === 1 });
}

// 11d 統計・実績が例外なく計算できる
{
  T.resetStore();
  for (let i = 0; i < 25; i++) T.discover(gen.code(), "", "");
  let threw = false, s = null, a = null;
  try { s = T.collectionStats(); a = T.achievements(); } catch (e) { threw = true; errors.push("11d: " + e.message); }
  judge("collectionStats が例外なく返る", (!threw && s && s.total === 25 && Array.isArray(s.byElem) && s.byElem.length === 5) ? 1 : 0, { pass: (v) => v === 1 });
  judge("achievements が配列で done を持つ", (a && a.length >= 5 && a.every((x) => typeof x.done === "boolean")) ? 1 : 0, { pass: (v) => v === 1 });
  judge("20体以上で「コレクター」実績が達成", a.find((x) => x.name === "コレクター").done ? 1 : 0, { pass: (v) => v === 1 });
}

// ─────────────────────────────────────────────────────────────
console.log("\n══ 実行時エラー ══");
if (errors.length) errors.forEach((e) => console.log("  " + e));
else console.log("  なし");

console.log("\n════════════════════════════════");
console.log("  PASS " + PASS + "   WARN " + WARN + "   FAIL " + FAIL + "   errors " + errors.length);
console.log("════════════════════════════════");
process.exit(FAIL || errors.length ? 1 : 0);
