import { describe, it, expect } from "vitest";
import { simInit, simStep, simFinish, type Team, type Capture } from "../lib/sim";
import { optimize, suggestTarget, describeStack, evaluate, naiveBounds, lineupIssues, fits, SLOTS, type SlatePlayer, type Joint } from "../lib/dfs";

const team = (abbr: string, mult = 1): Team => ({
  abbr, name: abbr, pace: 1, def: { pass: 1, run: 1, cb: 1 },
  players: [
    { name: `${abbr} QB`, pos: "QB", pAtt: 34 * mult, cmp: .66, ypa: 7.4, pTD: 1.8 * mult, iNT: .6, rYd: 12, rTD: .2, depth: "QB1" },
    { name: `${abbr} RB1`, pos: "RB", car: 15 * mult, ypc: 4.3, ruTD: .6 * mult, tgt: 4, cr: .75, ypr: 7, recTD: .2, depth: "RB1" },
    { name: `${abbr} RB2`, pos: "RB", car: 7, ypc: 4.0, ruTD: .2, tgt: 2, cr: .7, ypr: 6, recTD: .1, depth: "RB2" },
    { name: `${abbr} WR1`, pos: "WR", tgt: 10 * mult, cr: .63, ypr: 13.5, recTD: .6 * mult, wr1: true, depth: "WR1" },
    { name: `${abbr} WR2`, pos: "WR", tgt: 7, cr: .62, ypr: 12, recTD: .4, depth: "WR2" },
    { name: `${abbr} WR3`, pos: "WR", tgt: 5, cr: .60, ypr: 11, recTD: .25, depth: "WR3" },
    { name: `${abbr} TE1`, pos: "TE", tgt: 5, cr: .68, ypr: 10, recTD: .3, depth: "TE1" },
  ],
});

/* Four games. Games are independent in reality, so simulating each on its own and pairing sim i of
   one with sim i of another is a valid joint sample of the whole slate. */
function slate(sims: number) {
  const games: [Team, Team][] = [
    [team("AAA", 1.15), team("BBB")], [team("CCC"), team("DDD", 1.1)],
    [team("EEE"), team("FFF")], [team("GGG"), team("HHH")],
  ];
  const per = games[0][0].players.length;
  const nPlayers = games.length * 2 * per;
  const buf = new Float32Array(nPlayers * sims);
  const pool: SlatePlayer[] = [];
  let base = 0;
  games.forEach(([h, a], gi) => {
    const capH: Capture = { buf, max: sims, base }, capA: Capture = { buf, max: sims, base: base + h.players.length };
    const st = simInit(h, a, 1000 + gi, capH, capA);
    simStep(st, sims);
    const res = simFinish(st);
    // simFinish sorts by projection, so map results back to the buffer by roster order.
    for (const [t, tRes, off, opp] of [[h, res.home, base, a.abbr], [a, res.away, base + h.players.length, h.abbr]] as const) {
      t.players.forEach((pl, i) => {
        const r = tRes.players.find((x) => x.name === pl.name)!;
        pool.push({ key: `${t.abbr}:${pl.name}`, name: pl.name, pos: pl.pos, depth: pl.depth, team: t.abbr, opp, home: t === h,
          game: `G${gi}`, fp: r.fp, sd: r.sd, p10: r.p10, p50: r.p50, p90: r.p90, boomPct: r.boomPct, bustPct: r.bustPct, tdPct: r.tdPct, col: off + i });
      });
    }
    base += h.players.length + a.players.length;
  });
  return { pool, J: { buf, sims } as Joint };
}

describe("lineup search on joint samples", () => {
  const SIMS = 6000;
  const { pool, J } = slate(SIMS);

  it("builds a legal lineup", () => {
    const [L] = optimize(pool, J, { target: suggestTarget(pool, J), count: 1, seed: 5 });
    expect(L.players).toHaveLength(8);
    expect(new Set(L.players.map((p) => p.key)).size).toBe(8);
    expect(L.players.filter((p) => p.pos === "QB")).toHaveLength(1);
    expect(L.players.filter((p) => p.pos === "RB").length).toBeGreaterThanOrEqual(2);
    expect(L.players.filter((p) => p.pos === "WR").length).toBeGreaterThanOrEqual(3);
    expect(L.players.filter((p) => p.pos === "TE").length).toBeGreaterThanOrEqual(1);
    expect(new Set(L.players.map((p) => p.game)).size).toBeGreaterThanOrEqual(2);  // DK's two-game rule
  });

  it("DISCOVERS stacking when the target is high — nothing here tells it to", () => {
    // The only difference between these two runs is the score being chased. If correlation were
    // absent (as in the engine this replaced) both would pick the same eight names.
    const hi = optimize(pool, J, { target: suggestTarget(pool, J) * 1.18, count: 6, seed: 11, restarts: 90 });
    const withQb = (L: typeof hi[number]) => { const q = L.players.find((p) => p.pos === "QB")!; return L.players.filter((p) => p !== q && p.team === q.team).length; };
    const stacked = hi.filter((L) => withQb(L) >= 1).length;
    expect(stacked / hi.length).toBeGreaterThan(0.5);
  });

  it("stacks LESS when chasing a low target, where floor beats upside", () => {
    const lo = optimize(pool, J, { target: suggestTarget(pool, J) * 0.55, count: 6, seed: 11, restarts: 90 });
    const hi = optimize(pool, J, { target: suggestTarget(pool, J) * 1.18, count: 6, seed: 11, restarts: 90 });
    const mates = (L: typeof lo[number]) => { const q = L.players.find((p) => p.pos === "QB")!; return L.players.filter((p) => p !== q && p.team === q.team).length; };
    const avg = (a: typeof lo) => a.reduce((s, L) => s + mates(L), 0) / a.length;
    expect(avg(hi)).toBeGreaterThan(avg(lo));
  });

  it("a stack really does have a fatter tail than the same-projection alternative", () => {
    const q = pool.find((p) => p.key === "AAA:AAA QB")!;
    const mate = pool.find((p) => p.key === "AAA:AAA WR1")!;
    const solo = pool.find((p) => p.key === "CCC:CCC WR1")!;   // similar player, unrelated game
    const pair = (a: typeof q, b: typeof q) => {
      let hits = 0; const th = 46;
      for (let i = 0; i < SIMS; i++) if (J.buf[a.col * SIMS + i] + J.buf[b.col * SIMS + i] >= th) hits++;
      return hits / SIMS;
    };
    // Comparable means, but the correlated pair reaches a big combined score more often.
    expect(Math.abs(mate.fp - solo.fp)).toBeLessThan(6);
    expect(pair(q, mate)).toBeGreaterThan(pair(q, solo));
  });

  it("ranks by hit rate, and reports a sane distribution", () => {
    const t = suggestTarget(pool, J);
    const Ls = optimize(pool, J, { target: t, count: 5, seed: 3, restarts: 60 });
    expect(Ls.length).toBeGreaterThan(1);
    for (let i = 1; i < Ls.length; i++) expect(Ls[i - 1].stats.hit).toBeGreaterThanOrEqual(Ls[i].stats.hit);
    const L = Ls[0];
    expect(L.stats.p10).toBeLessThan(L.stats.p50);
    expect(L.stats.p50).toBeLessThan(L.stats.p90);
    expect(L.stats.hit).toBeGreaterThan(0); expect(L.stats.hit).toBeLessThan(1);
    expect(describeStack(L.players)).toBeTruthy();
  });

  it("honours locks and bans", () => {
    const must = pool.find((p) => p.key === "FFF:FFF TE1")!;
    const no = pool.find((p) => p.key === "AAA:AAA QB")!;
    const [L] = optimize(pool, J, { target: suggestTarget(pool, J), count: 1, seed: 9, locked: new Set([must.key]), banned: new Set([no.key]) });
    expect(L.players.map((p) => p.key)).toContain(must.key);
    expect(L.players.map((p) => p.key)).not.toContain(no.key);
  });
});

describe("target suggestion", () => {
  const { pool, J } = slate(4000);

  it("suggests a target a real lineup can actually reach", () => {
    /* The bug this guards: summing the best CEILING at each slot. Percentiles do not add, so that
       produced a target above anything achievable, every lineup scored a 0% hit rate, and the
       search lost its gradient entirely. */
    const t = suggestTarget(pool, J);
    const Ls = optimize(pool, J, { target: t, count: 3, seed: 21, restarts: 60 });
    expect(Ls[0].stats.hit).toBeGreaterThan(0.02);
    expect(Ls[0].stats.hit).toBeLessThan(0.95);
    expect(t).toBeLessThan(pool.filter((p) => p.pos !== "QB").sort((a, b) => b.p90 - a.p90).slice(0, 7).reduce((s, p) => s + p.p90, 0));
  });

  it("still returns a sensibly ranked lineup when the target is unreachable", () => {
    // Every candidate hits 0%, so the mean underneath the objective is all the climb has to follow.
    const Ls = optimize(pool, J, { target: suggestTarget(pool, J) * 3, count: 3, seed: 21, restarts: 40 });
    expect(Ls.length).toBeGreaterThan(0);
    expect(Ls[0].stats.hit).toBe(0);
    const best = optimize(pool, J, { target: suggestTarget(pool, J), count: 1, seed: 21, restarts: 40 })[0];
    expect(Ls[0].stats.mean).toBeGreaterThan(best.stats.mean * 0.85);   // not garbage — still a strong lineup
  });
});

describe("hand-built lineups", () => {
  const { pool, J } = slate(6000);
  const pick = (...keys: string[]) => keys.map((k) => pool.find((p) => p.key === k)!);

  it("scores a hand-built lineup exactly as the search scores its own", () => {
    const [L] = optimize(pool, J, { target: suggestTarget(pool, J), count: 1, seed: 17, restarts: 50 });
    const same = evaluate(L.players, J, suggestTarget(pool, J));
    // Same players, same samples — the builder must not produce a second opinion.
    expect(same.mean).toBeCloseTo(L.stats.mean, 4);
    expect(same.p10).toBeCloseTo(L.stats.p10, 4);
    expect(same.hit).toBeCloseTo(L.stats.hit, 6);
  });

  it("adds means exactly, because means DO add", () => {
    const ps = pick("AAA:AAA QB", "AAA:AAA WR1", "CCC:CCC RB1");
    expect(evaluate(ps, J, 0).mean).toBeCloseTo(ps.reduce((s, p) => s + p.fp, 0), 1);
  });

  it("puts the real floor ABOVE the sum of the floors, and the ceiling below", () => {
    /* The whole reason a lineup is scored on joint samples instead of on the board's columns:
       eight players do not all have their worst game at once, and rarely all boom at once. */
    const [L] = optimize(pool, J, { target: suggestTarget(pool, J), count: 1, seed: 4, restarts: 50 });
    const st = evaluate(L.players, J, 0), nv = naiveBounds(L.players);
    expect(st.p10).toBeGreaterThan(nv.p10);
    expect(st.p90).toBeLessThan(nv.p90);
  });

  it("scores a part-built lineup rather than refusing", () => {
    const st = evaluate(pick("AAA:AAA QB", "AAA:AAA WR1"), J, 40);
    expect(st.mean).toBeGreaterThan(0);
    expect(st.hit).toBeGreaterThan(0);
    expect(evaluate([], J, 40).mean).toBe(0);
  });

  it("names what is stopping a lineup being legal", () => {
    const seat = SLOTS.map(() => null) as (SlatePlayer | null)[];
    expect(lineupIssues(seat)[0]).toContain("8 slots");
    const oneGame = pool.filter((p) => p.game === "G0");
    const full = SLOTS.map((sl) => oneGame.find((p) => fits(p.pos, sl) && true)!);
    // Eight players all from a single game is a legal-looking roster that DraftKings rejects.
    expect(lineupIssues(full).join(" ")).toContain("games");
  });
});
