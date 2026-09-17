import { useState } from "react";

/* =========================================================================================
   GRIDIRON SIM — a real Monte-Carlo NFL game simulator.
   Each sim: team pace → play volume → per-player usage (carries/targets) → matchup-adjusted
   efficiency (offense vs the opponent's pass/run defense) → player-vs-player (WR1 vs the
   opponent's top CB) → home-field → real distributions (Gaussian yards, Poisson TDs, Binomial
   catches) → PPR fantasy points. Averaged over N sims. Not random noise — model expectations
   that converge as N grows. Dataset = curated recent-usage real players (not a live feed).
   ========================================================================================= */

type Pos = "QB" | "RB" | "WR" | "TE";
type Player = {
  name: string; pos: Pos;
  // QB
  pAtt?: number; cmp?: number; ypa?: number; pTD?: number; iNT?: number; rYd?: number; rTD?: number;
  // RB
  car?: number; ypc?: number; ruTD?: number;
  // pass-catchers (RB/WR/TE)
  tgt?: number; cr?: number; ypr?: number; recTD?: number; wr1?: boolean;
};
type Team = { abbr: string; name: string; pace: number; def: { pass: number; run: number; cb: number }; players: Player[] };

/* per-game BASE lines vs an average defense at a neutral site (grounded in recent real usage). */
const T: Record<string, Team> = {
  KC: { abbr: "KC", name: "Chiefs", pace: 1.0, def: { pass: 0.92, run: 1.02, cb: 0.95 }, players: [
    { name: "P. Mahomes", pos: "QB", pAtt: 35, cmp: 0.67, ypa: 7.2, pTD: 1.9, iNT: 0.6, rYd: 18, rTD: 0.2 },
    { name: "I. Pacheco", pos: "RB", car: 15, ypc: 4.3, ruTD: 0.5, tgt: 3, cr: 0.74, ypr: 6.5, recTD: 0.08 },
    { name: "R. Rice", pos: "WR", tgt: 8.5, cr: 0.68, ypr: 11.5, recTD: 0.45, wr1: true },
    { name: "X. Worthy", pos: "WR", tgt: 6.5, cr: 0.62, ypr: 12.5, recTD: 0.35 },
    { name: "T. Kelce", pos: "TE", tgt: 7.5, cr: 0.70, ypr: 10.5, recTD: 0.4 } ] },
  BUF: { abbr: "BUF", name: "Bills", pace: 1.05, def: { pass: 0.95, run: 0.98, cb: 1.0 }, players: [
    { name: "J. Allen", pos: "QB", pAtt: 32, cmp: 0.64, ypa: 7.6, pTD: 1.9, iNT: 0.6, rYd: 42, rTD: 0.6 },
    { name: "J. Cook", pos: "RB", car: 16, ypc: 4.6, ruTD: 0.55, tgt: 3.5, cr: 0.76, ypr: 7, recTD: 0.1 },
    { name: "K. Shakir", pos: "WR", tgt: 7, cr: 0.74, ypr: 11, recTD: 0.3, wr1: true },
    { name: "K. Coleman", pos: "WR", tgt: 6, cr: 0.58, ypr: 13, recTD: 0.35 },
    { name: "D. Kincaid", pos: "TE", tgt: 5.5, cr: 0.68, ypr: 9.5, recTD: 0.25 } ] },
  PHI: { abbr: "PHI", name: "Eagles", pace: 0.96, def: { pass: 0.9, run: 0.95, cb: 0.9 }, players: [
    { name: "J. Hurts", pos: "QB", pAtt: 30, cmp: 0.66, ypa: 7.8, pTD: 1.6, iNT: 0.5, rYd: 40, rTD: 0.9 },
    { name: "S. Barkley", pos: "RB", car: 20, ypc: 5.4, ruTD: 0.8, tgt: 3, cr: 0.78, ypr: 8, recTD: 0.1 },
    { name: "A.J. Brown", pos: "WR", tgt: 9, cr: 0.66, ypr: 14, recTD: 0.5, wr1: true },
    { name: "D. Smith", pos: "WR", tgt: 7.5, cr: 0.68, ypr: 12.5, recTD: 0.4 },
    { name: "D. Goedert", pos: "TE", tgt: 5, cr: 0.70, ypr: 10, recTD: 0.2 } ] },
  DAL: { abbr: "DAL", name: "Cowboys", pace: 1.02, def: { pass: 1.06, run: 1.03, cb: 1.0 }, players: [
    { name: "D. Prescott", pos: "QB", pAtt: 36, cmp: 0.68, ypa: 7.3, pTD: 1.8, iNT: 0.7, rYd: 8, rTD: 0.15 },
    { name: "J. Williams", pos: "RB", car: 14, ypc: 4.0, ruTD: 0.4, tgt: 3, cr: 0.72, ypr: 6, recTD: 0.08 },
    { name: "CeeDee Lamb", pos: "WR", tgt: 10, cr: 0.68, ypr: 12.5, recTD: 0.5, wr1: true },
    { name: "G. Pickens", pos: "WR", tgt: 7.5, cr: 0.60, ypr: 14.5, recTD: 0.4 },
    { name: "J. Ferguson", pos: "TE", tgt: 6, cr: 0.70, ypr: 9.5, recTD: 0.2 } ] },
  SF: { abbr: "SF", name: "49ers", pace: 1.0, def: { pass: 0.93, run: 0.96, cb: 0.95 }, players: [
    { name: "B. Purdy", pos: "QB", pAtt: 32, cmp: 0.67, ypa: 8.2, pTD: 1.7, iNT: 0.7, rYd: 15, rTD: 0.2 },
    { name: "C. McCaffrey", pos: "RB", car: 18, ypc: 4.8, ruTD: 0.7, tgt: 5.5, cr: 0.80, ypr: 8.5, recTD: 0.25 },
    { name: "R. Pearsall", pos: "WR", tgt: 7, cr: 0.64, ypr: 13, recTD: 0.35, wr1: true },
    { name: "J. Jennings", pos: "WR", tgt: 6.5, cr: 0.66, ypr: 11.5, recTD: 0.35 },
    { name: "G. Kittle", pos: "TE", tgt: 6, cr: 0.72, ypr: 12, recTD: 0.4 } ] },
  LAR: { abbr: "LAR", name: "Rams", pace: 1.0, def: { pass: 0.98, run: 1.0, cb: 1.0 }, players: [
    { name: "M. Stafford", pos: "QB", pAtt: 34, cmp: 0.66, ypa: 7.7, pTD: 1.9, iNT: 0.7, rYd: 5, rTD: 0.05 },
    { name: "K. Williams", pos: "RB", car: 18, ypc: 4.4, ruTD: 0.7, tgt: 3, cr: 0.74, ypr: 6, recTD: 0.08 },
    { name: "P. Nacua", pos: "WR", tgt: 9.5, cr: 0.70, ypr: 12.5, recTD: 0.4, wr1: true },
    { name: "D. Adams", pos: "WR", tgt: 8.5, cr: 0.64, ypr: 12.5, recTD: 0.5 },
    { name: "T. Higbee", pos: "TE", tgt: 4, cr: 0.68, ypr: 9, recTD: 0.15 } ] },
  BAL: { abbr: "BAL", name: "Ravens", pace: 0.98, def: { pass: 0.95, run: 0.9, cb: 0.95 }, players: [
    { name: "L. Jackson", pos: "QB", pAtt: 28, cmp: 0.66, ypa: 8.4, pTD: 1.8, iNT: 0.4, rYd: 55, rTD: 0.5 },
    { name: "D. Henry", pos: "RB", car: 19, ypc: 5.2, ruTD: 0.85, tgt: 1.5, cr: 0.70, ypr: 6, recTD: 0.05 },
    { name: "Z. Flowers", pos: "WR", tgt: 8, cr: 0.68, ypr: 12, recTD: 0.4, wr1: true },
    { name: "R. Bateman", pos: "WR", tgt: 5, cr: 0.60, ypr: 13.5, recTD: 0.3 },
    { name: "M. Andrews", pos: "TE", tgt: 5.5, cr: 0.66, ypr: 10.5, recTD: 0.4 } ] },
  CIN: { abbr: "CIN", name: "Bengals", pace: 1.02, def: { pass: 1.08, run: 1.05, cb: 1.0 }, players: [
    { name: "J. Burrow", pos: "QB", pAtt: 37, cmp: 0.69, ypa: 7.5, pTD: 2.1, iNT: 0.6, rYd: 8, rTD: 0.1 },
    { name: "C. Brown", pos: "RB", car: 16, ypc: 4.3, ruTD: 0.5, tgt: 4, cr: 0.76, ypr: 6.5, recTD: 0.1 },
    { name: "Ja'Marr Chase", pos: "WR", tgt: 10.5, cr: 0.68, ypr: 13.5, recTD: 0.6, wr1: true },
    { name: "T. Higgins", pos: "WR", tgt: 8, cr: 0.64, ypr: 13, recTD: 0.5 },
    { name: "M. Gesicki", pos: "TE", tgt: 4.5, cr: 0.68, ypr: 10, recTD: 0.15 } ] },
  DET: { abbr: "DET", name: "Lions", pace: 1.03, def: { pass: 1.0, run: 1.0, cb: 1.0 }, players: [
    { name: "J. Goff", pos: "QB", pAtt: 33, cmp: 0.70, ypa: 7.7, pTD: 1.9, iNT: 0.6, rYd: 5, rTD: 0.05 },
    { name: "J. Gibbs", pos: "RB", car: 15, ypc: 5.0, ruTD: 0.7, tgt: 4, cr: 0.78, ypr: 8.5, recTD: 0.2 },
    { name: "D. Montgomery", pos: "RB", car: 12, ypc: 4.3, ruTD: 0.6, tgt: 2, cr: 0.75, ypr: 6, recTD: 0.05 },
    { name: "A. St. Brown", pos: "WR", tgt: 9.5, cr: 0.74, ypr: 11, recTD: 0.5, wr1: true },
    { name: "J. Williams", pos: "WR", tgt: 6, cr: 0.58, ypr: 15, recTD: 0.35 },
    { name: "S. LaPorta", pos: "TE", tgt: 6, cr: 0.68, ypr: 10, recTD: 0.3 } ] },
  GB: { abbr: "GB", name: "Packers", pace: 1.0, def: { pass: 0.95, run: 0.98, cb: 0.98 }, players: [
    { name: "J. Love", pos: "QB", pAtt: 31, cmp: 0.64, ypa: 7.8, pTD: 1.8, iNT: 0.7, rYd: 12, rTD: 0.15 },
    { name: "J. Jacobs", pos: "RB", car: 18, ypc: 4.5, ruTD: 0.7, tgt: 3, cr: 0.76, ypr: 6.5, recTD: 0.1 },
    { name: "J. Reed", pos: "WR", tgt: 6.5, cr: 0.62, ypr: 13, recTD: 0.35, wr1: true },
    { name: "R. Doubs", pos: "WR", tgt: 6, cr: 0.64, ypr: 11.5, recTD: 0.35 },
    { name: "T. Kraft", pos: "TE", tgt: 5, cr: 0.68, ypr: 11, recTD: 0.25 } ] },
  MIN: { abbr: "MIN", name: "Vikings", pace: 1.0, def: { pass: 0.9, run: 1.0, cb: 0.92 }, players: [
    { name: "J.J. McCarthy", pos: "QB", pAtt: 32, cmp: 0.64, ypa: 7.2, pTD: 1.5, iNT: 0.8, rYd: 18, rTD: 0.2 },
    { name: "A. Jones", pos: "RB", car: 15, ypc: 4.5, ruTD: 0.5, tgt: 3.5, cr: 0.76, ypr: 7, recTD: 0.1 },
    { name: "J. Jefferson", pos: "WR", tgt: 10, cr: 0.66, ypr: 14, recTD: 0.55, wr1: true },
    { name: "J. Addison", pos: "WR", tgt: 7, cr: 0.64, ypr: 12.5, recTD: 0.35 },
    { name: "T.J. Hockenson", pos: "TE", tgt: 6, cr: 0.70, ypr: 10, recTD: 0.25 } ] },
  MIA: { abbr: "MIA", name: "Dolphins", pace: 1.05, def: { pass: 1.02, run: 1.05, cb: 1.0 }, players: [
    { name: "T. Tagovailoa", pos: "QB", pAtt: 34, cmp: 0.69, ypa: 7.6, pTD: 1.7, iNT: 0.7, rYd: 4, rTD: 0.05 },
    { name: "D. Achane", pos: "RB", car: 14, ypc: 4.8, ruTD: 0.5, tgt: 5, cr: 0.80, ypr: 8, recTD: 0.2 },
    { name: "T. Hill", pos: "WR", tgt: 9.5, cr: 0.64, ypr: 14, recTD: 0.5, wr1: true },
    { name: "J. Waddle", pos: "WR", tgt: 7, cr: 0.66, ypr: 13, recTD: 0.35 },
    { name: "J. Smith", pos: "TE", tgt: 5, cr: 0.72, ypr: 9, recTD: 0.2 } ] },
};

const GAMES = [
  { away: "KC", home: "BUF", slot: "Sun · 4:25 PM" },
  { away: "PHI", home: "DAL", slot: "Sun · 8:20 PM" },
  { away: "SF", home: "LAR", slot: "Sun · 4:05 PM" },
  { away: "BAL", home: "CIN", slot: "Sun · 1:00 PM" },
  { away: "DET", home: "GB", slot: "Thu · 8:15 PM" },
  { away: "MIN", home: "MIA", slot: "Mon · 8:15 PM" },
];

/* ---- seeded RNG + distributions ---- */
const mul = (a: number) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const gauss = (r: () => number, m: number, s: number) => { const u = r() || 1e-9; return m + s * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r()); };
const pois = (r: () => number, l: number) => { if (l <= 0) return 0; const L = Math.exp(-l); let k = 0, p = 1; do { k++; p *= r(); } while (p > L && k < 40); return k - 1; };
const binom = (r: () => number, n: number, p: number) => { let c = 0; for (let i = 0; i < n; i++) if (r() < p) c++; return c; };

type Line = { pAtt: number; cmp: number; pYd: number; pTD: number; int: number; car: number; ruYd: number; ruTD: number; tgt: number; rec: number; reYd: number; reTD: number };
const zero = (): Line => ({ pAtt: 0, cmp: 0, pYd: 0, pTD: 0, int: 0, car: 0, ruYd: 0, ruTD: 0, tgt: 0, rec: 0, reYd: 0, reTD: 0 });
const fpOf = (l: Line) => l.pYd * 0.04 + l.pTD * 4 - l.int * 2 + l.ruYd * 0.1 + l.ruTD * 6 + l.rec + l.reYd * 0.1 + l.reTD * 6;

function simPlayer(p: Player, d: Team["def"], hm: number, pace: number, r: () => number): { line: Line; teamTD: number } {
  const l = zero(); let teamTD = 0;
  if (p.pos === "QB") {
    const att = Math.max(8, Math.round(gauss(r, p.pAtt! * pace, p.pAtt! * 0.12)));
    l.pAtt = att; l.cmp = binom(r, att, clamp(p.cmp!, 0.35, 0.82));
    l.pYd = Math.max(0, Math.round(gauss(r, att * p.ypa! * d.pass * hm, att * p.ypa! * 0.22)));
    l.pTD = pois(r, p.pTD! * d.pass * hm * pace); l.int = pois(r, p.iNT! * (2 - d.pass));
    l.ruYd = Math.max(0, Math.round(gauss(r, p.rYd! * d.run * hm, Math.max(6, p.rYd! * 0.4)))); l.ruTD = pois(r, p.rTD! * pace);
    teamTD = l.pTD + l.ruTD;
  } else if (p.pos === "RB") {
    const car = Math.max(0, Math.round(gauss(r, p.car! * pace, p.car! * 0.16)));
    l.car = car; l.ruYd = Math.max(0, Math.round(gauss(r, car * p.ypc! * d.run * hm, Math.max(10, car * p.ypc! * 0.3)))); l.ruTD = pois(r, p.ruTD! * d.run * pace);
    l.tgt = Math.max(0, Math.round(gauss(r, p.tgt! * pace, Math.max(1, p.tgt! * 0.35)))); l.rec = binom(r, l.tgt, clamp(p.cr!, 0.3, 0.95));
    l.reYd = Math.max(0, Math.round(gauss(r, l.rec * p.ypr! * hm, Math.max(6, l.rec * p.ypr! * 0.35)))); l.reTD = pois(r, p.recTD!);
    teamTD = l.ruTD;
  } else {
    const mm = d.pass * (p.wr1 ? d.cb : 1) * hm;
    l.tgt = Math.max(0, Math.round(gauss(r, p.tgt! * pace, Math.max(1, p.tgt! * 0.28)))); l.rec = binom(r, l.tgt, clamp(p.cr!, 0.3, 0.9));
    l.reYd = Math.max(0, Math.round(gauss(r, l.rec * p.ypr! * mm, Math.max(8, l.rec * p.ypr! * 0.35)))); l.reTD = pois(r, p.recTD! * mm * pace);
  }
  return { line: l, teamTD };
}

type PRes = { name: string; pos: Pos; fp: number; sd: number; line: Line };
type TRes = { abbr: string; name: string; pts: number; winPct: number; players: PRes[] };

function simulate(home: Team, away: Team, N: number, seed: number): { home: TRes; away: TRes } {
  const r = mul(seed);
  const pace = (home.pace + away.pace) / 2;
  const acc = (t: Team) => t.players.map((p) => ({ p, sum: zero() as any, fpSum: 0, fp2: 0 }));
  const H = acc(home), A = acc(away);
  let winH = 0, winA = 0, tie = 0, ptsH = 0, ptsA = 0;
  const runTeam = (roster: typeof H, oppDef: Team["def"], hm: number) => {
    let td = 0;
    for (const e of roster) { const { line, teamTD } = simPlayer(e.p, oppDef, hm, pace, r); td += teamTD; for (const k in line) e.sum[k] += (line as any)[k]; const fp = fpOf(line); e.fpSum += fp; e.fp2 += fp * fp; }
    return td * 7 + pois(r, 1.6) * 3;
  };
  for (let i = 0; i < N; i++) {
    const pH = runTeam(H, away.def, 1.03), pA = runTeam(A, home.def, 0.985);
    ptsH += pH; ptsA += pA; if (pH > pA) winH++; else if (pA > pH) winA++; else tie++;
  }
  const finish = (t: Team, roster: typeof H, pts: number, win: number): TRes => ({
    abbr: t.abbr, name: t.name, pts: pts / N, winPct: (win + tie / 2) / N,
    players: roster.map((e) => { const line = zero() as any; for (const k in e.sum) line[k] = e.sum[k] / N; const mean = e.fpSum / N; return { name: e.p.name, pos: e.p.pos, fp: mean, sd: Math.sqrt(Math.max(0, e.fp2 / N - mean * mean)), line }; }).sort((a, b) => b.fp - a.fp),
  });
  return { home: finish(home, H, ptsH, winH), away: finish(away, A, ptsA, winA) };
}

/* ---- UI ---- */
const C = { bg: "#0a1410", panel: "#10201a", panel2: "#16281f", line: "#1f3a30", chalk: "#eaf3ee", mut: "#7fa394", field: "#2fbd6f", gold: "#ffd23f", red: "#ff5a52" };
const box = { background: "#10201a", border: "1px solid #1f3a30", borderRadius: 12 };
const num = (n: number, d = 1) => n.toFixed(d);

function statLine(p: PRes): string {
  const l = p.line;
  if (p.pos === "QB") return `${num(l.cmp, 0)}/${num(l.pAtt, 0)}, ${num(l.pYd, 0)} yd, ${num(l.pTD)} TD, ${num(l.int)} INT · ${num(l.ruYd, 0)} ru`;
  if (p.pos === "RB") return `${num(l.car, 0)} car, ${num(l.ruYd, 0)} yd, ${num(l.ruTD)} TD · ${num(l.rec)}/${num(l.tgt, 0)} for ${num(l.reYd, 0)}`;
  return `${num(l.rec)}/${num(l.tgt, 0)} tgt, ${num(l.reYd, 0)} yd, ${num(l.reTD)} TD`;
}

function Index() {
  const [sel, setSel] = useState<number | null>(null);
  const [sims, setSims] = useState(2000);
  const [res, setRes] = useState<{ home: TRes; away: TRes; n: number } | null>(null);
  const [busy, setBusy] = useState(false);

  const run = () => {
    if (sel == null) return;
    const g = GAMES[sel]; const n = clamp(Math.round(sims) || 1, 100, 100000);
    setBusy(true); setRes(null);
    setTimeout(() => {
      const out = simulate(T[g.home], T[g.away], n, (sel + 1) * 100003 + n);
      setRes({ ...out, n }); setBusy(false);
    }, 20);
  };

  const Team = ({ t }: { t: TRes }) => (
    <div style={box}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", borderBottom: `1px solid ${C.line}` }}>
        <div><span style={{ fontWeight: 800, fontSize: 18 }}>{t.abbr}</span> <span style={{ color: C.mut, fontSize: 12 }}>{t.name}</span></div>
        <div style={{ textAlign: "right" }}><div style={{ fontFamily: "ui-monospace,monospace", fontSize: 22, fontWeight: 800, color: C.field }}>{num(t.pts)}</div><div style={{ fontSize: 11, color: C.mut }}>{num(t.winPct * 100)}% win</div></div>
      </div>
      <div style={{ padding: 6 }}>
        {t.players.map((p) => (
          <div key={p.name} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 8px", borderBottom: `1px solid #14261f` }}>
            <span style={{ width: 30, fontSize: 10, fontWeight: 800, color: p.pos === "QB" ? C.gold : p.pos === "RB" ? "#57c7ff" : p.pos === "WR" ? "#ff8ad1" : "#c6a0ff" }}>{p.pos}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700 }}>{p.name}</div>
              <div style={{ fontSize: 11, color: C.mut, fontFamily: "ui-monospace,monospace", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{statLine(p)}</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontFamily: "ui-monospace,monospace", fontSize: 17, fontWeight: 800, color: C.chalk }}>{num(p.fp)}</div>
              <div style={{ fontSize: 10, color: C.mut }}>±{num(p.sd)} FP</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", background: `radial-gradient(120% 80% at 50% 0%, #12261c, ${C.bg})`, color: C.chalk, fontFamily: "system-ui,sans-serif" }}>
      <div style={{ maxWidth: 1000, margin: "0 auto", padding: "22px 16px 60px" }}>
        {/* header */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 4 }}>
          <div style={{ fontSize: 26 }}>🏈</div>
          <div>
            <h1 style={{ margin: 0, fontSize: 26, fontWeight: 900, letterSpacing: -0.5 }}>GRIDIRON&nbsp;SIM</h1>
            <div style={{ fontSize: 12, color: C.mut }}>Monte-Carlo NFL game simulator · Week slate · PPR scoring</div>
          </div>
        </div>

        {sel == null ? (
          <>
            <div style={{ margin: "18px 0 10px", fontSize: 13, color: C.mut, textTransform: "uppercase", letterSpacing: 1 }}>This Week's Games — tap to simulate</div>
            <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))" }}>
              {GAMES.map((g, i) => (
                <button key={i} onClick={() => { setSel(i); setRes(null); }} style={{ ...box, cursor: "pointer", textAlign: "left", padding: "14px 16px", color: C.chalk, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ fontSize: 17, fontWeight: 800 }}>{T[g.away].abbr} <span style={{ color: C.mut, fontWeight: 400 }}>@</span> {T[g.home].abbr}</div>
                    <div style={{ fontSize: 11, color: C.mut }}>{T[g.away].name} at {T[g.home].name}</div>
                  </div>
                  <div style={{ textAlign: "right", fontSize: 11, color: C.field }}>{g.slot}<div style={{ color: C.mut, marginTop: 2 }}>simulate ▸</div></div>
                </button>
              ))}
            </div>
            <p style={{ marginTop: 22, fontSize: 11, color: C.mut, lineHeight: 1.6 }}>
              Real Monte-Carlo model: each sim runs team pace → play volume → per-player usage → matchup-adjusted efficiency (offense vs the opponent's pass/run D) → WR1 vs the opponent's top CB → home-field → Gaussian yards / Poisson TDs / Binomial catches, scored PPR and averaged over your N sims. Numbers converge as N grows — not random. Player pool = curated recent real usage (not a live feed).
            </p>
          </>
        ) : (
          <>
            <button onClick={() => { setSel(null); setRes(null); }} style={{ background: "none", border: "none", color: C.mut, cursor: "pointer", fontSize: 13, margin: "14px 0", padding: 0 }}>‹ all games</button>
            <div style={{ ...box, padding: 16, marginBottom: 16, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 14, justifyContent: "space-between" }}>
              <div style={{ fontSize: 22, fontWeight: 900 }}>{T[GAMES[sel].away].abbr} @ {T[GAMES[sel].home].abbr} <span style={{ color: C.mut, fontSize: 13, fontWeight: 400 }}>· {GAMES[sel].slot}</span></div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <label style={{ fontSize: 12, color: C.mut }}># sims</label>
                <input type="number" value={sims} min={100} max={100000} onChange={(e) => setSims(Number(e.target.value))} style={{ width: 100, ...box, color: C.chalk, padding: "9px 10px", fontFamily: "ui-monospace,monospace" }} />
                {[1000, 10000, 50000].map((n) => <button key={n} onClick={() => setSims(n)} style={{ ...box, color: C.mut, cursor: "pointer", padding: "8px 8px", fontSize: 11 }}>{n >= 1000 ? n / 1000 + "k" : n}</button>)}
                <button onClick={run} disabled={busy} style={{ background: `linear-gradient(135deg,${C.field},#1e8f52)`, color: "#04140c", border: "none", borderRadius: 10, fontWeight: 900, padding: "10px 18px", cursor: "pointer" }}>{busy ? "SIMULATING…" : "RUN ▸"}</button>
              </div>
            </div>

            {busy && <div style={{ textAlign: "center", padding: 40, color: C.mut }}>running {sims.toLocaleString()} simulations…</div>}
            {res && !busy && (
              <>
                <div style={{ textAlign: "center", marginBottom: 12, fontSize: 13, color: C.mut }}>
                  averaged over <b style={{ color: C.chalk }}>{res.n.toLocaleString()}</b> sims · projected <b style={{ color: C.field }}>{T[GAMES[sel].away].abbr} {num(res.away.pts)}</b> — <b style={{ color: C.field }}>{num(res.home.pts)} {T[GAMES[sel].home].abbr}</b> · {(res.home.pts > res.away.pts ? T[GAMES[sel].home].abbr : T[GAMES[sel].away].abbr)} favored {num(Math.max(res.home.winPct, res.away.winPct) * 100)}%
                </div>
                <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))" }}>
                  <Team t={res.away} /><Team t={res.home} />
                </div>
                <div style={{ marginTop: 10, fontSize: 11, color: C.mut, textAlign: "center" }}>each player: avg fantasy points (PPR) ± std-dev, with the averaged stat line across all {res.n.toLocaleString()} sims.</div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default Index;
