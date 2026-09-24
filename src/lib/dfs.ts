/* =========================================================================================
   LINEUP SEARCH OVER THE JOINT SIMULATION

   Every projection tool ranks PLAYERS. A lineup is not eight independent players though — its
   outcome is one number, and how that number is distributed depends on whether its members tend to
   boom in the same games. Two lineups with identical summed projections can have very different
   chances of reaching a winning score, and the difference is entirely correlation.

   So nothing here is scored from a mean or a ceiling. Each lineup is evaluated on the per-simulation
   outcomes themselves: the eight columns are summed sim by sim, and the resulting distribution is
   read directly. A stack shows up as a fatter right tail because those players actually did boom
   together in the same simulated games.

   Which means stacking is never instructed. There is no "pair the QB with a receiver" rule in this
   file. Ask for a high enough target and the search finds stacks by itself, because on the joint
   samples they genuinely reach it more often. That is the part a single-number projection cannot do.
   ========================================================================================= */
import type { Pos } from "./sim";

export type SlatePlayer = {
  key: string; name: string; pos: Pos; depth?: string;
  team: string; opp: string; home: boolean; game: string;
  fp: number; sd: number; p10: number; p50: number; p90: number;
  boomPct: number; bustPct: number; tdPct: number;
  col: number;                      // this player's column in the joint buffer
};
export type Joint = { buf: Float32Array; sims: number };

/* DraftKings NFL classic, minus DST and K — the data source carries no defensive or kicking usage,
   so inventing them would put two made-up numbers into every lineup. Eight real slots instead. */
export const SLOTS = ["QB", "RB", "RB", "WR", "WR", "WR", "TE", "FLEX"] as const;
export type Slot = typeof SLOTS[number];
export const fits = (pos: Pos, slot: Slot) => (slot === "FLEX" ? pos !== "QB" : pos === slot);

export type LineupStats = { mean: number; sd: number; p10: number; p50: number; p90: number; hit: number };
export type Lineup = { players: SlatePlayer[]; stats: LineupStats; stack: string };

/* ---- distribution of a lineup, read off the joint samples ---- */
function sumInto(out: Float32Array, J: Joint, cols: number[]) {
  out.fill(0);
  for (const c of cols) { const off = c * J.sims; for (let i = 0; i < J.sims; i++) out[i] += J.buf[off + i]; }
}
/* The search objective. Hit rate is what we actually care about, but ranking on it ALONE breaks
   badly when the target is out of reach: every candidate scores 0, the climb has no gradient to
   follow, and the search returns whatever it started from. Adding the mean underneath keeps a
   direction to move in — scaled so that even a single simulation's worth of hit rate outranks any
   difference in mean, so this never quietly turns into a projection-maximiser. */
const objOf = (tot: Float32Array, n: number, target: number) => {
  let h = 0, s = 0;
  for (let i = 0; i < n; i++) { const v = tot[i]; if (v >= target) h++; s += v; }
  return (h / n) * 1e5 + s / n;
};
const hitRate = (tot: Float32Array, n: number, target: number) => {
  let h = 0; for (let i = 0; i < n; i++) if (tot[i] >= target) h++;
  return h / n;
};
function statsOf(tot: Float32Array, n: number, target: number): LineupStats {
  let s = 0, s2 = 0;
  for (let i = 0; i < n; i++) { s += tot[i]; s2 += tot[i] * tot[i]; }
  const mean = s / n;
  const sorted = Float32Array.prototype.slice.call(tot, 0, n).sort();
  const q = (p: number) => sorted[Math.min(n - 1, Math.floor(p * n))];
  return { mean, sd: Math.sqrt(Math.max(0, s2 / n - mean * mean)), p10: q(0.10), p50: q(0.50), p90: q(0.90), hit: hitRate(tot, n, target) };
}

/* ---- how a lineup is stacked, for display only — never an input to the search ---- */
export function describeStack(ps: SlatePlayer[]): string {
  const qb = ps.find((p) => p.pos === "QB");
  if (!qb) return "no QB";
  const withQb = ps.filter((p) => p !== qb && p.team === qb.team).length;
  const back = ps.filter((p) => p.team === qb.opp).length;
  if (!withQb) return "no stack";
  return `${withQb + 1}-man ${qb.team}` + (back ? ` + ${back} back` : "");
}

const MIN_GAMES = 2;               // DraftKings requires a lineup to span at least two games
const okGames = (ps: (SlatePlayer | null)[]) => new Set(ps.filter(Boolean).map((p) => p!.game)).size >= MIN_GAMES;

export type OptOpts = {
  target: number;                  // the score the lineup is trying to BEAT
  count: number;                   // how many distinct lineups to return
  searchSims?: number;             // cheaper sample while searching; finalists are rescored in full
  restarts?: number;
  poolPerSlot?: number;
  seed?: number;
  locked?: Set<string>;            // players that must appear
  banned?: Set<string>;
};

export function optimize(pool: SlatePlayer[], J: Joint, o: OptOpts): Lineup[] {
  const rnd = (() => { let a = (o.seed ?? 1) | 0; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();
  const avail = pool.filter((p) => !o.banned?.has(p.key));
  const sims = Math.min(J.sims, o.searchSims ?? 2500);
  const restarts = o.restarts ?? 60;
  const K = o.poolPerSlot ?? 40;

  /* Shortlist per slot. The full pool is mostly players no lineup would ever take, and searching
     them is the whole cost. Ranked by ceiling because that is what a target-beating lineup needs. */
  const short: Record<Slot, SlatePlayer[]> = {} as any;
  for (const s of new Set(SLOTS)) short[s] = avail.filter((p) => fits(p.pos, s)).sort((a, b) => b.p90 - a.p90).slice(0, K);

  const locked = avail.filter((p) => o.locked?.has(p.key));
  const tot = new Float32Array(sims);
  const scratch = new Float32Array(sims);

  const seatLocked = (seat: (SlatePlayer | null)[]) => {
    for (const p of locked) {
      let placed = false;
      for (let i = 0; i < SLOTS.length && !placed; i++) if (!seat[i] && fits(p.pos, SLOTS[i])) { seat[i] = p; placed = true; }
    }
  };

  const results = new Map<string, Lineup>();
  for (let r = 0; r < restarts; r++) {
    const seat: (SlatePlayer | null)[] = new Array(SLOTS.length).fill(null);
    seatLocked(seat);
    // Random valid start — restarts are what stop the climb settling in the same local optimum.
    for (let i = 0; i < SLOTS.length; i++) {
      if (seat[i]) continue;
      const c = short[SLOTS[i]];
      for (let a = 0; a < 40; a++) { const p = c[Math.floor(rnd() * c.length)]; if (p && !seat.includes(p)) { seat[i] = p; break; } }
    }
    if (seat.some((x) => !x)) continue;

    sumInto(tot, J, seat.map((p) => p!.col));
    let best = objOf(tot, sims, o.target);

    /* Hill-climb one seat at a time. A swap only changes one column, so the lineup total updates in
       a single subtract-and-add pass instead of a full re-sum. */
    for (let pass = 0; pass < 6; pass++) {
      let moved = false;
      for (let i = 0; i < SLOTS.length; i++) {
        const cur = seat[i]!;
        if (o.locked?.has(cur.key)) continue;
        let bestP: SlatePlayer | null = null, bestH = best;
        for (const cand of short[SLOTS[i]]) {
          if (cand === cur || seat.includes(cand)) continue;
          seat[i] = cand;
          if (!okGames(seat)) { seat[i] = cur; continue; }
          const oOff = cur.col * J.sims, nOff = cand.col * J.sims;
          for (let k = 0; k < sims; k++) scratch[k] = tot[k] - J.buf[oOff + k] + J.buf[nOff + k];
          const h = objOf(scratch, sims, o.target);
          seat[i] = cur;
          if (h > bestH) { bestH = h; bestP = cand; }
        }
        if (bestP) {
          const oOff = cur.col * J.sims, nOff = bestP.col * J.sims;
          for (let k = 0; k < sims; k++) tot[k] += J.buf[nOff + k] - J.buf[oOff + k];
          seat[i] = bestP; best = bestH; moved = true;
        }
      }
      if (!moved) break;
    }

    const ps = seat as SlatePlayer[];
    if (!okGames(ps)) continue;
    const id = ps.map((p) => p.key).sort().join("|");
    if (!results.has(id)) results.set(id, { players: ps.slice(), stats: { mean: 0, sd: 0, p10: 0, p50: 0, p90: 0, hit: 0 }, stack: describeStack(ps) });
  }

  /* Rescore the survivors on the FULL sample — the search ran on a cheap slice, which is fine for
     ranking moves but too noisy to separate the finalists. */
  const full = new Float32Array(J.sims);
  const out = [...results.values()];
  for (const L of out) { sumInto(full, J, L.players.map((p) => p.col)); L.stats = statsOf(full, J.sims, o.target); }
  return out.sort((a, b) => b.stats.hit - a.stats.hit || b.stats.mean - a.stats.mean).slice(0, o.count);
}

/* A sensible default target: what a strong lineup actually reaches one time in ten.

   The obvious version of this — add up the best ceiling available at each slot — is wrong, and
   wrong in a direction that breaks the search. Percentiles do not add: eight players do NOT all
   hit their 90th percentile in the same game, so the sum of the ceilings sits far above the
   ceiling of the sum. On live data that produced a target of 316 against a best realistic lineup
   of 255, every candidate scored a 0% hit rate, and the tournament search had no gradient at all.

   So the target is read off the joint samples instead: build the best lineup by projection, then
   ask what IT reaches in the top decile of its own simulated outcomes. */
export function suggestTarget(pool: SlatePlayer[], J: Joint): number {
  const used = new Set<SlatePlayer>(); const cols: number[] = [];
  for (const s of SLOTS) {
    const p = pool.filter((x) => fits(x.pos, s) && !used.has(x)).sort((a, b) => b.fp - a.fp)[0];
    if (p) { used.add(p); cols.push(p.col); }
  }
  if (!cols.length) return 0;
  const tot = new Float32Array(J.sims);
  sumInto(tot, J, cols);
  const sorted = Float32Array.prototype.slice.call(tot, 0, J.sims).sort();
  return Math.round(sorted[Math.floor(0.90 * J.sims)]);
}
