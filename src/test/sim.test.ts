import { describe, it, expect } from "vitest";
import { simInit, simStep, simFinish, regressToPrior, type Team, type Capture } from "../lib/sim";

/* Two ordinary offences, built so the correlation questions have a clean answer: one clear WR1,
   a second receiver, a lead back and a tight end. */
const mk = (abbr: string): Team => ({
  abbr, name: abbr, pace: 1, def: { pass: 1, run: 1, cb: 1 },
  players: [
    { name: "QB", pos: "QB", pAtt: 34, cmp: 0.66, ypa: 7.4, pTD: 1.8, iNT: 0.6, rYd: 12, rTD: 0.2, depth: "QB1" },
    { name: "RB", pos: "RB", car: 15, ypc: 4.3, ruTD: 0.6, tgt: 4, cr: 0.75, ypr: 7, recTD: 0.2, depth: "RB1" },
    { name: "WR1", pos: "WR", tgt: 10, cr: 0.63, ypr: 13.5, recTD: 0.6, wr1: true, depth: "WR1" },
    { name: "WR2", pos: "WR", tgt: 7, cr: 0.62, ypr: 12, recTD: 0.4, depth: "WR2" },
    { name: "TE", pos: "TE", tgt: 5, cr: 0.68, ypr: 10, recTD: 0.3, depth: "TE1" },
  ],
});

/* Pull per-sim fantasy points for every player in one game, so correlations can be measured
   across simulations rather than inferred from summary numbers. */
function joint(n: number, seed = 99) {
  const home = mk("HOM"), away = mk("AWY");
  const nH = home.players.length, nA = away.players.length;
  const buf = new Float32Array((nH + nA) * n);
  const capH: Capture = { buf, max: n, base: 0 };
  const capA: Capture = { buf, max: n, base: nH };
  const st = simInit(home, away, seed, capH, capA);
  simStep(st, n);
  const col = (i: number) => Array.from(buf.subarray(i * n, i * n + n));
  return { st, col, nH, res: simFinish(st) };
}

const corr = (a: number[], b: number[]) => {
  const n = a.length, ma = a.reduce((s, x) => s + x, 0) / n, mb = b.reduce((s, x) => s + x, 0) / n;
  let cov = 0, va = 0, vb = 0;
  for (let i = 0; i < n; i++) { cov += (a[i] - ma) * (b[i] - mb); va += (a[i] - ma) ** 2; vb += (b[i] - mb) ** 2; }
  return cov / Math.sqrt(va * vb);
};

describe("correlated engine", () => {
  const N = 20000;
  const { col, nH, res } = joint(N);
  const [QB, RB, WR1, WR2, TE] = [0, 1, 2, 3, 4];

  it("couples a QB to his own WR1 — the whole basis of a stack", () => {
    // The engine this replaced measured -0.003 here, because both were drawn independently.
    // Real-world QB/WR1 is around +0.6; anything meaningfully positive means the stack is real.
    const c = corr(col(QB), col(WR1));
    expect(c).toBeGreaterThan(0.35);
    expect(c).toBeLessThan(0.95);        // perfectly coupled would mean the WR *is* the offence
  });

  it("couples the QB to his other pass-catchers too, but less than to the WR1", () => {
    expect(corr(col(QB), col(WR2))).toBeGreaterThan(0.2);
    expect(corr(col(QB), col(WR1))).toBeGreaterThan(corr(col(QB), col(TE)));
  });

  it("makes team-mates who share targets compete", () => {
    // Both rise with team volume, but each target the WR1 takes is one the WR2 does not get, so
    // they must be far less coupled to each other than either is to the passer feeding both.
    expect(corr(col(WR1), col(WR2))).toBeLessThan(corr(col(QB), col(WR1)));
  });

  it("leaves a runner largely uncoupled from the passing game", () => {
    expect(Math.abs(corr(col(QB), col(RB)))).toBeLessThan(0.3);
  });

  it("correlates opposing receivers positively — the bring-back", () => {
    // Shared pace shock: a shootout lifts both sides. Weak, but it must not be zero or negative.
    expect(corr(col(WR1), col(nH + WR1))).toBeGreaterThan(0);
  });

  it("keeps the QB's line internally consistent with his receivers", () => {
    const qb = res.home.players.find((p) => p.name === "QB")!;
    const catchers = res.home.players.filter((p) => p.name !== "QB");
    const recSum = catchers.reduce((s, p) => s + p.line.rec, 0);
    const ydSum = catchers.reduce((s, p) => s + p.line.reYd, 0);
    // The QB is scaled up by a single factor covering the receivers we do not carry, so his line
    // is not equal to the sum — it is PROPORTIONAL to it, by the same factor on every field.
    expect(qb.line.cmp).toBeGreaterThan(recSum);
    expect(qb.line.cmp / recSum).toBeCloseTo(qb.line.pYd / ydSum, 1);
    expect(qb.line.cmp / recSum).toBeLessThan(2.3);
  });

  it("still produces sane fantasy output", () => {
    const wr1 = res.home.players.find((p) => p.name === "WR1")!;
    expect(wr1.fp).toBeGreaterThan(8); expect(wr1.fp).toBeLessThan(28);
    expect(wr1.p10).toBeLessThan(wr1.p50); expect(wr1.p50).toBeLessThan(wr1.p90);
    expect(res.home.pts).toBeGreaterThan(10); expect(res.home.pts).toBeLessThan(40);
  });

  it("gives a fresh seed a different answer, and a repeated seed the same one", () => {
    const a = joint(3000, 7).res.home.pts, b = joint(3000, 8).res.home.pts, c = joint(3000, 7).res.home.pts;
    expect(a).not.toBe(b);
    expect(a).toBe(c);
  });
});

describe("small-sample regression", () => {
  const hot: Parameters<typeof regressToPrior>[0] = {
    name: "Hot Start", pos: "WR", tgt: 13.5, cr: 0.77, ypr: 16.3, recTD: 2.0,
  };

  it("pulls a two-game hot streak most of the way back to the prior", () => {
    const r = regressToPrior(hot, 2);
    expect(r.recTD!).toBeLessThan(hot.recTD! / 2);      // 2 TD/game in two games is mostly variance
    expect(r.tgt!).toBeLessThan(hot.tgt!);
    expect(r.tgt!).toBeGreaterThan(5);                   // but real volume is not thrown away either
  });

  it("regresses scoring harder than volume, because it is noisier", () => {
    const r = regressToPrior(hot, 2);
    const kept = (now: number, was: number, prior: number) => (now - prior) / (was - prior);
    expect(kept(r.recTD!, hot.recTD!, 0.32)).toBeLessThan(kept(r.tgt!, hot.tgt!, 5.5));
  });

  it("fades as the season accumulates", () => {
    const early = regressToPrior(hot, 2).recTD!, late = regressToPrior(hot, 16).recTD!;
    expect(late).toBeGreaterThan(early);
    expect(late).toBeGreaterThan(hot.recTD! * 0.6);      // by December it is nearly a no-op
  });

  it("puts a player with no recorded usage ON the prior, not at zero", () => {
    const r = regressToPrior({ name: "Unused", pos: "TE" }, 0);
    expect(r.tgt).toBeCloseTo(4.0, 5);
    expect(r.ypr).toBeCloseTo(10.5, 5);
  });

  it("leaves a full season of real production broadly intact", () => {
    const r = regressToPrior({ name: "Stud", pos: "WR", tgt: 10, cr: 0.65, ypr: 13, recTD: 0.6 }, 17);
    expect(r.tgt!).toBeGreaterThan(9); expect(r.recTD!).toBeGreaterThan(0.45);
  });
});
