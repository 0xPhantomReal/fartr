import { it } from "vitest";
import { simInit, simStep, simFinish, regressToPrior, type Team, type Player, type Capture, type Pos } from "../lib/sim";
import { optimize, suggestTarget, evaluate, naiveBounds, type SlatePlayer, type Joint } from "../lib/dfs";

const SORTS = ["receiving.receptions","receiving.receivingTargets","rushing.rushingAttempts","rushing.rushingYards","passing.passingAttempts","scoring.totalTouchdowns","general.gamesPlayed"];
const SKILL = new Set(["QB","RB","WR","TE"]);
const CAP: Record<string, number> = { QB: 2, RB: 3, WR: 5, TE: 3 };

/* Hits the live ESPN API, so it is opt-in rather than part of the default run — a network blip
   should never fail the suite. Run it deliberately after touching the engine or the loaders:

       LIVE=1 npx vitest run src/test/live.test.ts

   It is what caught the two bugs the unit tests could not: a 41-point Josh Allen projected off a
   two-game sample, and a suggested target built by adding percentiles that no lineup could reach. */
it.skipIf(!process.env.LIVE)("end to end on live ESPN data", { timeout: 180000 }, async () => {
  /* ---- real season usage ---- */
  const seen = new Map<string, any>(); let labels: Record<string, string[]> = {};
  for (const s of SORTS) {
    const r = await fetch(`https://site.api.espn.com/apis/common/v3/sports/football/nfl/statistics/byathlete?limit=1000&sort=${s}`);
    if (!r.ok) continue; const d: any = await r.json();
    if (!Object.keys(labels).length) for (const c of d.categories || []) labels[c.name] = c.names || [];
    for (const at of d.athletes || []) { const id = at?.athlete?.id; if (id && !seen.has(id)) seen.set(id, at); }
  }
  const val = (at: any, cat: string, n: string) => { const c = (at.categories||[]).find((x:any)=>x.name===cat); const i=(labels[cat]||[]).indexOf(n);
    const v = i>=0&&c?.values?c.values[i]:null; return typeof v==="number"&&isFinite(v)?v:0; };
  const byTeam: Record<string, Player[]> = {};
  for (const at of seen.values()) {
    const pos = at?.athlete?.position?.abbreviation as Pos, tm = at?.athlete?.teamShortName;
    if (!SKILL.has(pos) || !tm) continue;
    const gp = Math.max(1, val(at,"general","gamesPlayed")), per = (c:string,n:string)=>val(at,c,n)/gp;
    const tgt = per("receiving","receivingTargets"), recs = val(at,"receiving","receptions"), tgts = val(at,"receiving","receivingTargets");
    const p: Player = { name: at.athlete.displayName, pos };
    if (pos === "QB") { p.pAtt=per("passing","passingAttempts"); p.cmp=(val(at,"passing","completionPct")||62)/100;
      p.ypa=val(at,"passing","yardsPerPassAttempt")||6.8; p.pTD=per("passing","passingTouchdowns"); p.iNT=per("passing","interceptions");
      p.rYd=val(at,"rushing","rushingYardsPerGame"); p.rTD=per("rushing","rushingTouchdowns"); if(!(p.pAtt>2))continue; }
    else if (pos === "RB") { p.car=per("rushing","rushingAttempts"); p.ypc=val(at,"rushing","yardsPerRushAttempt")||4.2;
      p.ruTD=per("rushing","rushingTouchdowns"); p.tgt=tgt; p.cr=tgts>0?recs/tgts:.72; p.ypr=val(at,"receiving","yardsPerReception")||7;
      p.recTD=per("receiving","receivingTouchdowns"); if(!(p.car>=.5||tgt>=.5))continue; }
    else { p.tgt=tgt; p.cr=tgts>0?recs/tgts:.62; p.ypr=val(at,"receiving","yardsPerReception")||11;
      p.recTD=per("receiving","receivingTouchdowns"); if(!(tgt>=.5))continue; }
    (byTeam[tm] ??= []).push(regressToPrior(p, gp));
  }
  const use = (p: Player) => (p.pAtt??0)+(p.car??0)+(p.tgt??0);
  const T: Record<string, Team> = {};
  for (const [abbr, ps] of Object.entries(byTeam)) {
    const kept: Player[] = [];
    for (const pos of ["QB","RB","WR","TE"] as Pos[]) {
      ps.filter(p=>p.pos===pos).sort((a,b)=>use(b)-use(a)).slice(0,CAP[pos])
        .forEach((p,i)=>kept.push({...p, depth: pos+(i+1), wr1: pos==="WR"&&i===0}));
    }
    T[abbr] = { abbr, name: abbr, pace: 1, def: { pass: 1, run: 1, cb: 1 }, players: kept.sort((a,b)=>use(b)-use(a)) };
  }

  /* ---- real slate + odds ---- */
  const sb: any = await (await fetch("https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=20260927")).json();
  const games: any[] = [];
  for (const e of sb.events || []) {
    const c = e.competitions?.[0]; if (!c) continue;
    const aC = c.competitors.find((x:any)=>x.homeAway==="away"), hC = c.competitors.find((x:any)=>x.homeAway==="home");
    const away = aC?.team?.abbreviation, home = hC?.team?.abbreviation;
    if (!T[away] || !T[home]) continue;
    const od = c.odds?.[0]; const ou = Number(od?.overUnder)||undefined;
    let sh: number|undefined, impH: number|undefined, impA: number|undefined;
    const dm = String(od?.details||"").match(/^([A-Z]{2,4})\s*([+-]?[\d.]+)/);
    if (dm) { const n = Number(dm[2]); if (isFinite(n)) sh = dm[1]===home ? n : -n; }
    if (ou!=null && sh!=null) { impH = +(ou/2 - sh/2).toFixed(1); impA = +(ou-impH).toFixed(1); }
    games.push({ away, home, ou, impH, impA });
  }

  /* ---- sim the slate with joint capture ---- */
  const N = 8000;
  const nP = games.reduce((k,g)=>k+T[g.home].players.length+T[g.away].players.length, 0);
  const buf = new Float32Array(nP * N);
  const pool: SlatePlayer[] = []; let base = 0;
  const t0 = Date.now();
  games.forEach((g, gi) => {
    const H = T[g.home], A = T[g.away];
    const capH: Capture = { buf, max: N, base }, capA: Capture = { buf, max: N, base: base + H.players.length };
    const st = simInit(H, A, 7000+gi, capH, capA); simStep(st, N);
    const res = simFinish(st);
    for (const [t, tr, off, opp, isH, imp] of [[H,res.home,base,g.away,true,g.impH],[A,res.away,base+H.players.length,g.home,false,g.impA]] as const) {
      t.players.forEach((pl, i) => { const r = tr.players.find(x=>x.name===pl.name); if(!r) return;
        pool.push({ key:`${t.abbr}:${pl.name}`, name: pl.name, pos: pl.pos, depth: pl.depth, team: t.abbr, opp, home: isH,
          game:`G${gi}`, fp:r.fp, sd:r.sd, p10:r.p10, p50:r.p50, p90:r.p90, boomPct:r.boomPct, bustPct:r.bustPct, tdPct:r.tdPct,
          col: off+i, implied: imp } as any); });
    }
    base += H.players.length + A.players.length;
  });
  const simMs = Date.now()-t0;
  const J: Joint = { buf, sims: N };

  console.log(`\n  SLATE: ${games.length} games · ${pool.length} players · ${N} sims each · ${(simMs/1000).toFixed(1)}s · ${(buf.byteLength/1048576).toFixed(1)}MB joint\n`);
  console.log("  TOP 12 BY CEILING");
  console.log("    " + "PLAYER".padEnd(26) + "TM  OPP   IMP  FLOOR  PROJ   CEIL   TD%  BOOM");
  for (const p of pool.slice().sort((a,b)=>b.p90-a.p90).slice(0,12))
    console.log("    " + `${p.depth} ${p.name}`.padEnd(26) + `${p.team.padEnd(3)} ${p.opp.padEnd(4)} ${String((p as any).implied ?? "-").padStart(4)} ${p.p10.toFixed(1).padStart(6)} ${p.fp.toFixed(1).padStart(5)} ${p.p90.toFixed(1).padStart(6)} ${(p.tdPct*100).toFixed(0).padStart(4)}% ${(p.boomPct*100).toFixed(0).padStart(4)}%`);

  /* ---- what the hand builder shows for a lineup you pick yourself ---- */
  {
    const take = (pos: string, n: number) => pool.filter(p => p.pos === pos).sort((a,b)=>b.fp-a.fp).slice(0, n);
    const mine = [...take("QB",1), ...take("RB",2), ...take("WR",3), ...take("TE",1), ...take("WR",4)[3] ? [take("WR",4)[3]] : []];
    const st = evaluate(mine, J, 0), nv = naiveBounds(mine);
    console.log(`\n  HAND-BUILT (top projection at each slot)`);
    console.log(`    ${mine.map(p=>p.name.split(" ").slice(-1)[0]).join(" ")}`);
    console.log(`    projected ${st.mean.toFixed(1)}  floor ${st.p10.toFixed(1)}  ceiling ${st.p90.toFixed(1)}`);
    console.log(`    adding the players' OWN floors gives ${nv.p10.toFixed(1)} and their own ceilings ${nv.p90.toFixed(1)}`);
    console.log(`    -> floor understated by ${(st.p10-nv.p10).toFixed(1)}, ceiling overstated by ${(nv.p90-st.p90).toFixed(1)}`);
  }

  const tgt = suggestTarget(pool, J);
  console.log(`\n  suggested target: ${tgt}`);
  for (const [lbl, mult] of [["CASH  (low target)", 0.60], ["GPP   (high target)", 1.15]] as const) {
    const t1 = Date.now();
    const Ls = optimize(pool, J, { target: Math.round(tgt*mult), count: 3, restarts: 110, seed: 42 });
    console.log(`\n  ${lbl} — target ${Math.round(tgt*mult)} · search ${((Date.now()-t1)/1000).toFixed(1)}s`);
    Ls.forEach((L,i)=>{
      console.log(`    #${i+1}  hit ${(L.stats.hit*100).toFixed(1)}%  proj ${L.stats.mean.toFixed(1)}  floor ${L.stats.p10.toFixed(1)}  ceil ${L.stats.p90.toFixed(1)}  [${L.stack}]`);
      console.log(`         ${L.players.map(p=>`${p.name.split(" ").slice(-1)[0]}(${p.team})`).join(" ")}`);
    });
  }
});
