/* =========================================================================================
   CORRELATED GAME SIMULATION

   The engine this replaces drew every player's volume independently: the quarterback rolled his
   own pass attempts, his receiver rolled his own targets, and nothing tied them together. The
   measured correlation between a QB and his own WR1 was -0.003. In reality it is about +0.60,
   because every one of that receiver's catches IS one of the quarterback's completions.

   That zero is fatal for anything built on stacks — a QB paired with his top receiver would score
   exactly like two unrelated players, so a lineup tool ranking stacks on it would be ranking noise.

   So volume flows DOWNWARD here, the way it does in a real game:

       game environment  →  team volume  →  player shares  →  the QB's line is the SUM

   One shared pace shock per game (shootouts lift both sides). One game-script tilt, applied with
   opposite sign to each team, so the side that is behind throws more. Team pass attempts split
   into targets by share. And critically, the quarterback's completions, yards and touchdowns are
   not drawn at all — they are aggregated from what his receivers did, which makes the stack
   correlation structural rather than something bolted on with a fudge factor.
   ========================================================================================= */

export type Pos = "QB" | "RB" | "WR" | "TE";
export type Player = {
  name: string; pos: Pos;
  // QB
  pAtt?: number; cmp?: number; ypa?: number; pTD?: number; iNT?: number; rYd?: number; rTD?: number;
  // RB
  car?: number; ypc?: number; ruTD?: number;
  // pass-catchers (RB/WR/TE)
  tgt?: number; cr?: number; ypr?: number; recTD?: number; wr1?: boolean;
  // Depth-chart label (WR1/RB2/TE1…). DERIVED, never baked: stamped after injuries and roster
  // cuts land, so benching a team's WR1 promotes WR2 instead of leaving a hole.
  depth?: string;
};
export type Team = { abbr: string; name: string; pace: number; def: { pass: number; run: number; cb: number }; players: Player[] };

export type Line = { pAtt: number; cmp: number; pYd: number; pTD: number; int: number; car: number; ruYd: number; ruTD: number; tgt: number; rec: number; reYd: number; reTD: number };
export const zero = (): Line => ({ pAtt: 0, cmp: 0, pYd: 0, pTD: 0, int: 0, car: 0, ruYd: 0, ruTD: 0, tgt: 0, rec: 0, reYd: 0, reTD: 0 });

/* DraftKings NFL classic scoring: full PPR, plus the 3-point yardage bonuses. The bonuses matter
   more than they look — they are a pure ceiling effect, awarded only in the right tail, so leaving
   them out would flatten exactly the part of the distribution a tournament lineup is chasing. */
export const fpOf = (l: Line) =>
  l.pYd * 0.04 + l.pTD * 4 - l.int * 2 + (l.pYd >= 300 ? 3 : 0) +
  l.ruYd * 0.1 + l.ruTD * 6 + (l.ruYd >= 100 ? 3 : 0) +
  l.rec + l.reYd * 0.1 + l.reTD * 6 + (l.reYd >= 100 ? 3 : 0);

/* ---- seeded RNG + distributions ---- */
export const mul = (a: number) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export const gauss = (r: () => number, m: number, s: number) => { const u = r() || 1e-9; return m + s * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r()); };
export const pois = (r: () => number, l: number) => { if (l <= 0) return 0; const L = Math.exp(-l); let k = 0, p = 1; do { k++; p *= r(); } while (p > L && k < 40); return k - 1; };
export const binom = (r: () => number, n: number, p: number) => { let c = 0; for (let i = 0; i < n; i++) if (r() < p) c++; return c; };

/* A 0.5-point histogram per player — the per-sim spread is the whole story, and collapsing it to a
   mean is what made the old output look identical run to run. 200 buckets is a few KB and answers
   any percentile. */
export const HB = 200, HW = 0.5;
export const pctOf = (h: Uint32Array, n: number, q: number) => {
  const want = q * n; let c = 0;
  for (let i = 0; i < HB; i++) { c += h[i]; if (c >= want) return i * HW; }
  return (HB - 1) * HW;
};

/* Week-to-week wobble in a player's share of his offense. This is the second source of spread
   after game volume: a receiver's target count moves both because the team threw more and because
   his slice of it moved, and the two compound. */
const SHARE_SD = 0.32;
const PACE_SD = 0.17;      // shared game pace shock — shootouts lift BOTH sides
const TILT_SD = 0.07;      // game script, opposite sign per team — the side that trails throws more

export type Roles = {
  qb: number; catchers: number[]; rushers: number[]; tdRush: number[];
  baseTgt: number; baseCar: number; baseRecTD: number; baseRuTD: number;
  /* The listed receivers never account for the whole passing game: we carry a team's top few
     pass-catchers, and the rest of the attempts go to depth players and throwaways. Splitting the
     QUARTERBACK's attempts among them would hand each listed receiver a 20-30% raise. So volume is
     allocated against the receivers' own totals, and the quarterback's line is scaled back UP by
     these factors — which preserves every correlation exactly, a scalar multiple being invisible
     to a correlation coefficient, while keeping both sides calibrated. */
  fAtt: number; fTD: number;
};
export function roles(ps: Player[]): Roles {
  const catchers: number[] = [], rushers: number[] = [], tdRush: number[] = [];
  let qb = -1;
  ps.forEach((p, i) => {
    if (p.pos === "QB" && qb < 0) qb = i;                         // QB1 takes the snaps; QB2 is depth, not a committee
    if ((p.tgt ?? 0) > 0) catchers.push(i);
    if ((p.car ?? 0) > 0) rushers.push(i);
    if ((p.ruTD ?? 0) > 0 || (p.pos === "QB" && (p.rTD ?? 0) > 0)) tdRush.push(i);
  });
  const sum = (idx: number[], f: (p: Player) => number) => idx.reduce((s, i) => s + (f(ps[i]) || 0), 0);
  const baseTgt = sum(catchers, (p) => p.tgt ?? 0), baseCar = sum(rushers, (p) => p.car ?? 0);
  const baseRecTD = sum(catchers, (p) => p.recTD ?? 0);
  const baseRuTD = tdRush.reduce((s, i) => s + (ps[i].pos === "QB" ? (ps[i].rTD ?? 0) : (ps[i].ruTD ?? 0)), 0);
  const q = qb >= 0 ? ps[qb] : null;
  return {
    qb, catchers, rushers, tdRush, baseTgt, baseCar, baseRecTD, baseRuTD,
    fAtt: clamp(baseTgt > 0 && q?.pAtt ? q.pAtt / baseTgt : 1, 1, 2.2),
    fTD: clamp(baseRecTD > 0 && q?.pTD ? q.pTD / baseRecTD : 1, 1, 2.2),
  };
}

export type Acc = { p: Player; sum: Line; fpSum: number; fp2: number; hist: Uint32Array; boom: number; bust: number };
export const mkAcc = (t: Team): Acc[] => t.players.map((p) => ({ p, sum: zero(), fpSum: 0, fp2: 0, hist: new Uint32Array(HB), boom: 0, bust: 0 }));

/* Optional joint capture. Ranking a LINEUP needs the per-sim outcomes kept side by side, not each
   player's histogram — a stack's whole point is that its members boom in the SAME simulations, and
   marginal summaries throw away precisely that. Layout is [player][sim], row-major. */
export type Capture = { buf: Float32Array; max: number; base: number };

export type SimState = {
  home: Team; away: Team; H: Acc[]; A: Acc[]; hR: Roles; aR: Roles;
  r: () => number; pace: number; done: number;
  winH: number; winA: number; tie: number; ptsH: number; ptsA: number; ptsH2: number; ptsA2: number;
  capH?: Capture; capA?: Capture;
};

export function simInit(home: Team, away: Team, seed: number, capH?: Capture, capA?: Capture): SimState {
  return {
    home, away, H: mkAcc(home), A: mkAcc(away), hR: roles(home.players), aR: roles(away.players),
    r: mul(seed), pace: (home.pace + away.pace) / 2, done: 0,
    winH: 0, winA: 0, tie: 0, ptsH: 0, ptsA: 0, ptsH2: 0, ptsA2: 0, capH, capA,
  };
}

/* Reused scratch — a Line object per player per simulation would be millions of allocations. Both
   teams share it safely because each team's lines are accumulated before the next team runs. */
const scratch: Line[] = [];
const W = new Float64Array(64);
function getScratch(n: number): Line[] {
  while (scratch.length < n) scratch.push(zero());
  for (let i = 0; i < n; i++) { const l = scratch[i]; l.pAtt = 0; l.cmp = 0; l.pYd = 0; l.pTD = 0; l.int = 0; l.car = 0; l.ruYd = 0; l.ruTD = 0; l.tgt = 0; l.rec = 0; l.reYd = 0; l.reTD = 0; }
  return scratch;
}

/* Hand out `count` scores over `idx` by weight. Sequential roulette rather than an independent
   Poisson each: a touchdown given to the WR is the SAME touchdown the QB threw, which is what
   couples their lines instead of letting both spike independently. */
function allot(r: () => number, count: number, idx: number[], w: Float64Array, sw: number, L: Line[], field: "reTD" | "ruTD") {
  for (let t = 0; t < count; t++) {
    let x = r() * sw;
    for (let k = 0; k < idx.length; k++) { x -= w[k]; if (x <= 0 || k === idx.length - 1) { L[idx[k]][field]++; break; } }
  }
}

function runTeam(st: SimState, acc: Acc[], R: Roles, oppDef: Team["def"], hm: number, envPace: number, passTilt: number, cap: Capture | undefined, simIdx: number): number {
  const r = st.r, n = acc.length, L = getScratch(n);
  const qb = R.qb >= 0 ? acc[R.qb].p : null;

  /* ---- team target volume, then each receiver's share of it ---- */
  const baseAtt = (R.baseTgt || 20) * envPace * passTilt;
  const teamAtt = Math.max(6, Math.round(gauss(r, baseAtt, baseAtt * 0.13)));
  let sw = 0;
  for (let k = 0; k < R.catchers.length; k++) {
    const p = acc[R.catchers[k]].p;
    W[k] = Math.max(1e-4, (p.tgt ?? 0) * Math.exp(gauss(r, 0, SHARE_SD)));
    sw += W[k];
  }
  let attTot = 0, cmpTot = 0, yTot = 0;
  for (let k = 0; k < R.catchers.length; k++) {
    const i = R.catchers[k], p = acc[i].p, l = L[i];
    const tg = Math.max(0, Math.round(teamAtt * (W[k] / (sw || 1))));
    const mm = oppDef.pass * (p.wr1 ? oppDef.cb : 1) * hm;        // WR1 draws the opponent's best corner
    const ypr = p.ypr ?? 11;
    l.tgt = tg;
    l.rec = binom(r, tg, clamp(p.cr ?? 0.62, 0.3, 0.95));
    l.reYd = Math.max(0, Math.round(gauss(r, l.rec * ypr * mm, Math.max(6, l.rec * ypr * 0.35))));
    attTot += tg; cmpTot += l.rec; yTot += l.reYd;
  }

  /* ---- rushing volume, same share treatment ---- */
  const rushTilt = 2 - passTilt;                                   // throwing more means running less
  let rw = 0;
  for (let k = 0; k < R.rushers.length; k++) {
    const p = acc[R.rushers[k]].p;
    W[k] = Math.max(1e-4, (p.car ?? 0) * Math.exp(gauss(r, 0, SHARE_SD)));
    rw += W[k];
  }
  const baseCar = R.baseCar * envPace * rushTilt;
  const teamCar = Math.max(0, Math.round(gauss(r, baseCar, Math.max(2, baseCar * 0.15))));
  for (let k = 0; k < R.rushers.length; k++) {
    const i = R.rushers[k], p = acc[i].p, l = L[i];
    const car = Math.max(0, Math.round(teamCar * (W[k] / (rw || 1))));
    const ypc = p.ypc ?? 4.2;
    l.car = car;
    l.ruYd = Math.max(0, Math.round(gauss(r, car * ypc * oppDef.run * hm, Math.max(8, car * ypc * 0.3))));
  }

  /* ---- scoring: ONE team draw per phase, then handed out ---- */
  let stw = 0;
  for (let k = 0; k < R.catchers.length; k++) { W[k] = Math.max(1e-4, acc[R.catchers[k]].p.recTD ?? 0); stw += W[k]; }
  const passTD = pois(r, R.baseRecTD * oppDef.pass * hm * envPace * passTilt);
  allot(r, passTD, R.catchers, W, stw, L, "reTD");

  let rtw = 0;
  for (let k = 0; k < R.tdRush.length; k++) { const p = acc[R.tdRush[k]].p; W[k] = Math.max(1e-4, p.pos === "QB" ? (p.rTD ?? 0) : (p.ruTD ?? 0)); rtw += W[k]; }
  const rushTD = pois(r, R.baseRuTD * oppDef.run * envPace * rushTilt);
  allot(r, rushTD, R.tdRush, W, rtw, L, "ruTD");

  /* ---- the quarterback's line is AGGREGATED, never drawn ---- */
  if (qb && R.qb >= 0) {
    const l = L[R.qb];
    // Scaled by fAtt/fTD to cover the receivers we do not carry — see Roles. A scalar multiple
    // leaves every correlation untouched, so the stack survives the calibration.
    l.pAtt = Math.round(attTot * R.fAtt); l.cmp = Math.round(cmpTot * R.fAtt);
    l.pYd = Math.round(yTot * R.fAtt); l.pTD = Math.round(passTD * R.fTD);
    l.int = pois(r, (qb.iNT ?? 0.6) * (2 - oppDef.pass));
    l.ruYd = Math.max(0, Math.round(gauss(r, (qb.rYd ?? 0) * oppDef.run * hm, Math.max(6, (qb.rYd ?? 0) * 0.4))));
  }

  /* ---- accumulate ---- */
  for (let i = 0; i < n; i++) {
    const e = acc[i], l = L[i];
    e.sum.pAtt += l.pAtt; e.sum.cmp += l.cmp; e.sum.pYd += l.pYd; e.sum.pTD += l.pTD; e.sum.int += l.int;
    e.sum.car += l.car; e.sum.ruYd += l.ruYd; e.sum.ruTD += l.ruTD;
    e.sum.tgt += l.tgt; e.sum.rec += l.rec; e.sum.reYd += l.reYd; e.sum.reTD += l.reTD;
    const fp = fpOf(l);
    e.fpSum += fp; e.fp2 += fp * fp;
    e.hist[Math.min(HB - 1, Math.max(0, Math.floor(fp / HW)))]++;
    if (fp >= 20) e.boom++; if (fp < 10) e.bust++;
    if (cap && simIdx < cap.max) cap.buf[(cap.base + i) * cap.max + simIdx] = fp;
  }
  return (Math.round(passTD * R.fTD) + rushTD) * 7 + pois(r, 1.6) * 3;
}

export function simStep(st: SimState, k: number) {
  for (let i = 0; i < k; i++) {
    const idx = st.done + i;
    // Shared per-GAME draws. Both teams see the same pace shock (shootouts are mutual) and opposite
    // halves of the same script tilt — which is what makes a bring-back correlate with the stack.
    const envPace = st.pace * Math.exp(gauss(st.r, 0, PACE_SD));
    const tilt = gauss(st.r, 0, TILT_SD);
    const pH = runTeam(st, st.H, st.hR, st.away.def, 1.03, envPace, 1 - tilt, st.capH, idx);
    const pA = runTeam(st, st.A, st.aR, st.home.def, 0.985, envPace, 1 + tilt, st.capA, idx);
    st.ptsH += pH; st.ptsA += pA; st.ptsH2 += pH * pH; st.ptsA2 += pA * pA;
    if (pH > pA) st.winH++; else if (pA > pH) st.winA++; else st.tie++;
  }
  st.done += k;
}

export type PRes = { name: string; pos: Pos; depth?: string; fp: number; sd: number; line: Line; p10: number; p50: number; p90: number; boomPct: number; bustPct: number; tdPct: number };
export type TRes = { abbr: string; name: string; pts: number; ptsSd: number; winPct: number; players: PRes[] };

export function simFinish(st: SimState): { home: TRes; away: TRes } {
  const N = Math.max(1, st.done);
  const finish = (t: Team, roster: Acc[], pts: number, pts2: number, win: number): TRes => {
    const mp = pts / N;
    return {
      abbr: t.abbr, name: t.name, pts: mp, ptsSd: Math.sqrt(Math.max(0, pts2 / N - mp * mp)), winPct: (win + st.tie / 2) / N,
      players: roster.map((e) => {
        const line = zero() as any;
        for (const k in e.sum) line[k] = (e.sum as any)[k] / N;
        const mean = e.fpSum / N;
        return {
          name: e.p.name, pos: e.p.pos, depth: e.p.depth, fp: mean,
          sd: Math.sqrt(Math.max(0, e.fp2 / N - mean * mean)), line,
          p10: pctOf(e.hist, N, 0.10), p50: pctOf(e.hist, N, 0.50), p90: pctOf(e.hist, N, 0.90),
          boomPct: e.boom / N, bustPct: e.bust / N,
          // Expected TDs → P(at least one). The sim already draws them, so this is read off the
          // model rather than quoted from a book's anytime-TD price.
          // A quarterback carries no receiving TDs, so this is his RUSHING score chance — which is
          // what an anytime-TD market prices for him too.
          tdPct: 1 - Math.exp(-((line.reTD ?? 0) + (line.ruTD ?? 0))),
        };
      }).sort((a, b) => b.fp - a.fp),
    };
  };
  return { home: finish(st.home, st.H, st.ptsH, st.ptsH2, st.winH), away: finish(st.away, st.A, st.ptsA, st.ptsA2, st.winA) };
}

/* =========================================================================================
   SMALL-SAMPLE REGRESSION

   Three weeks into a season a per-game rate is an average of two or three games, and taking it at
   face value projects the hot start forward forever. Measured on live week-3 data: Josh Allen had
   5 passing and 4 rushing touchdowns in two games, so the raw rates implied 4.5 TD a game and a
   41-point projection — roughly double any honest number.

   So each rate is pulled toward a positional prior by the standard shrinkage weight

       adjusted = (observed x games + prior x k) / (games + k)

   where k is how many games of prior it takes to outweigh what we have seen. k differs by stat
   because they stabilise at very different speeds: volume is a coaching decision and settles fast,
   efficiency takes longer, and touchdown rate is the noisiest number in football — four scores in
   two games says far more about variance than about talent. As games accumulate the prior fades on
   its own, so by December this is very nearly a no-op.
   ========================================================================================= */
const PRIOR: Record<Pos, Partial<Record<keyof Player, number>>> = {
  QB: { pAtt: 32, cmp: 0.64, ypa: 7.0, pTD: 1.45, iNT: 0.7, rYd: 14, rTD: 0.25 },
  RB: { car: 11, ypc: 4.2, ruTD: 0.35, tgt: 3.0, cr: 0.73, ypr: 7.0, recTD: 0.12 },
  WR: { tgt: 5.5, cr: 0.62, ypr: 12.0, recTD: 0.32 },
  TE: { tgt: 4.0, cr: 0.68, ypr: 10.5, recTD: 0.28 },
};
// Games of prior per stat. Volume first (settles quickest), then efficiency, then scoring.
const K: Partial<Record<keyof Player, number>> = {
  pAtt: 3, car: 3, tgt: 3,
  cmp: 5, ypa: 6, ypc: 6, ypr: 6, cr: 5,
  pTD: 7, iNT: 7, rTD: 8, ruTD: 8, recTD: 8,
  rYd: 4,
};

/** Shrink a player's observed per-game rates toward the positional prior, given games played. */
export function regressToPrior(p: Player, gp: number): Player {
  const pr = PRIOR[p.pos]; if (!pr) return p;
  const g = Math.max(0, gp || 0);
  const out: Player = { ...p };
  for (const key of Object.keys(pr) as (keyof Player)[]) {
    const prior = pr[key]; const k = K[key] ?? 5;
    if (prior == null) continue;
    const obs = out[key];
    // A player with no recorded usage at all sits ON the prior rather than at zero — otherwise a
    // backup with one carry would be projected as though he never touches the ball again.
    const v = typeof obs === "number" && isFinite(obs) ? obs : prior;
    (out as any)[key] = (v * g + prior * k) / (g + k);
  }
  return out;
}
