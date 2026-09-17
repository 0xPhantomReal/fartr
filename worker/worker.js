/* ============================================================================
   Gridiron Sim — NFL data proxy (Cloudflare Worker)

   WHY THIS EXISTS: SportsDataIO needs a secret key and sends no CORS header, so
   a static site can't call it directly. This Worker holds the key as a secret,
   adds CORS, and normalizes the data into the sim's exact player-rate format.

   DATA CHAIN (honors "SportsDataIO first, free as backup"):
     players : SportsDataIO PlayerSeasonStats  ->  nflverse player_stats CSV
     games   : SportsDataIO Schedules          ->  nflverse nfldata games.csv
   If SDIO is down / out of credits / a season is unauthorized, it silently
   falls through to the free nflverse feeds. Responses are cached (players 6h,
   games 10m) to protect your free-plan quota.

   ENDPOINTS (all JSON, Access-Control-Allow-Origin: *):
     GET /          health + which season/week/source it resolved
     GET /games     { season, week, source, games:[{away,home,slot,hML,aML}] }
     GET /players   { season, week, source, teams:{ ABBR:{abbr,pace,def,players:[…]} } }

   DEPLOY (no local tooling needed):
     Cloudflare dashboard -> Workers & Pages -> Create -> Worker -> paste this -> Deploy.
     Then the Worker's  Settings -> Variables and Secrets -> add a SECRET
       named  SDIO_KEY  = your SportsDataIO key.
     (Without the secret it still works via the free nflverse backup.)
   ========================================================================== */

const SDIO = "https://api.sportsdata.io/v3/nfl";
const NFLV_STATS = (y) => `https://github.com/nflverse/nflverse-data/releases/download/player_stats/player_stats_${y}.csv`;
const NFLV_GAMES = "https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,OPTIONS", "content-type": "application/json" };
const json = (obj, sMax) => new Response(JSON.stringify(obj), { headers: { ...CORS, "cache-control": `public, max-age=${sMax}` } });
const err = (msg, code = 502) => new Response(JSON.stringify({ error: String(msg) }), { status: code, headers: CORS });

const num = (v) => (Number(v) || 0);
const per = (v, g) => (g > 0 ? num(v) / g : 0);
const ratio = (a, b) => (num(b) > 0 ? num(a) / num(b) : 0);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;

async function sdioGet(path, key) {
  const r = await fetch(`${SDIO}/${path}?key=${key}`, { cf: { cacheTtl: 600, cacheEverything: true } });
  if (!r.ok) throw new Error(`SDIO ${path} -> ${r.status}`);
  const j = await r.json();
  if (!Array.isArray(j) && typeof j === "object" && j && "HttpStatusCode" in j) throw new Error(`SDIO ${path}: ${j.Description || j.Code}`);
  return j;
}
async function text(url) {
  const r = await fetch(url, { cf: { cacheTtl: 3600, cacheEverything: true }, headers: { "user-agent": "gridiron-sim" } });
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r.text();
}

/* quote-aware CSV -> array of row objects (nflverse has commas inside quoted URLs) */
function parseCSV(txt) {
  const rows = []; let f = "", row = [], q = false;
  for (let i = 0; i < txt.length; i++) {
    const c = txt[i];
    if (q) { if (c === '"') { if (txt[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(f); f = ""; }
    else if (c === "\n") { row.push(f); rows.push(row); row = []; f = ""; }
    else if (c !== "\r") f += c;
  }
  if (f.length || row.length) { row.push(f); rows.push(row); }
  const head = rows.shift() || [];
  return rows.filter((r) => r.length > 1).map((r) => { const o = {}; head.forEach((h, i) => (o[h] = r[i])); return o; });
}

/* ---- unified aggregate -> the sim's Player rate model ---- */
const POS_OK = { QB: 1, RB: 1, WR: 1, TE: 1 };
function toPlayer(a) {
  const g = Math.max(1, a.g);
  const name = a.name, pos = a.pos;
  if (pos === "QB") {
    const pAtt = clamp(per(a.pAtt, g), 0, 45);
    if (pAtt < 8) return null;
    return { name, pos: "QB",
      pAtt: r1(pAtt), cmp: r2(clamp(ratio(a.cmp, a.pAtt) || 0.64, 0.4, 0.75)),
      ypa: r2(clamp(ratio(a.pYd, a.pAtt) || 7, 5, 10)),
      pTD: r2(per(a.pTD, g)), iNT: r2(per(a.pINT, g)),
      rYd: r1(per(a.ruYd, g)), rTD: r2(per(a.ruTD, g)) };
  }
  const recPG = per(a.rec, g);
  if (pos === "RB") {
    const car = clamp(per(a.car, g), 0, 28);
    if (car < 3 && recPG < 1.5) return null;
    const tgtPG = a.tgt != null ? per(a.tgt, g) : recPG / 0.75;
    const cr = a.tgt != null && tgtPG > 0 ? clamp(recPG / tgtPG, 0.3, 0.95) : 0.75;
    return { name, pos: "RB",
      car: r1(car), ypc: r2(clamp(ratio(a.ruYd, a.car) || 4.2, 3, 6)), ruTD: r2(per(a.ruTD, g)),
      tgt: r1(clamp(tgtPG, 0, 10)), cr: r2(cr), ypr: r1(clamp(ratio(a.reYd, a.rec) || 7, 4, 12)), recTD: r2(per(a.reTD, g)) };
  }
  // WR / TE
  if (recPG < 1.2) return null;
  const dCr = pos === "WR" ? 0.63 : 0.68;
  const tgtPG = a.tgt != null ? per(a.tgt, g) : recPG / dCr;
  const cr = a.tgt != null && tgtPG > 0 ? clamp(recPG / tgtPG, 0.3, 0.9) : dCr;
  return { name, pos,
    tgt: r1(clamp(tgtPG, 0, 15)), cr: r2(cr), ypr: r1(clamp(ratio(a.reYd, a.rec) || 11, 6, 18)), recTD: r2(per(a.reTD, g)) };
}

/* keep a believable depth chart per team, not the whole league */
const volume = (p) => (p.pos === "QB" ? p.pAtt : p.pos === "RB" ? p.car * 1.5 + p.tgt : p.tgt);
function packTeams(aggs) {
  const byTeam = {};
  for (const a of aggs) {
    const p = toPlayer(a); if (!p || !a.team) continue;
    (byTeam[a.team] ||= { abbr: a.team, pace: 1.0, def: { pass: 1.0, run: 1.0, cb: 1.0 }, players: [] }).players.push(p);
  }
  const cap = { QB: 1, RB: 3, WR: 4, TE: 2 };
  for (const t in byTeam) {
    const grp = {}; byTeam[t].players.forEach((p) => (grp[p.pos] ||= []).push(p));
    const keep = [];
    for (const pos in grp) { grp[pos].sort((x, y) => volume(y) - volume(x)); keep.push(...grp[pos].slice(0, cap[pos] || 2)); }
    const wr = keep.filter((p) => p.pos === "WR").sort((x, y) => y.tgt - x.tgt); if (wr[0]) wr[0].wr1 = true;
    byTeam[t].players = keep;
  }
  return byTeam;
}

/* ---- SportsDataIO sources ---- */
async function sdioSeasonWeek(key) {
  const season = num(await sdioGet("scores/json/CurrentSeason", key)) || new Date().getFullYear();
  let week = 1; try { week = num(await sdioGet("scores/json/CurrentWeek", key)) || 1; } catch {}
  return { season, week };
}
// team defense + pace multipliers, relative to league average, clamped (real matchup logic)
async function sdioDefense(key, year) {
  try {
    const rows = await sdioGet(`scores/json/TeamSeasonStats/${year}REG`, key);
    if (!Array.isArray(rows) || !rows.length) return null;
    const dg = (t, f) => per(t[f], num(t.Games) || 17);
    const avg = (f) => rows.reduce((s, t) => s + dg(t, f), 0) / rows.length;
    const aPass = avg("OpponentPassingYards"), aRush = avg("OpponentRushingYards"), aPlays = avg("OffensivePlays");
    const aYPA = ratio(rows.reduce((s, t) => s + num(t.OpponentPassingYards), 0), rows.reduce((s, t) => s + num(t.OpponentPassingAttempts), 0));
    const map = {};
    for (const t of rows) {
      const ypa = ratio(t.OpponentPassingYards, t.OpponentPassingAttempts);
      map[t.Team] = {
        pace: r2(clamp(dg(t, "OffensivePlays") / aPlays, 0.9, 1.1)),
        def: { pass: r2(clamp(dg(t, "OpponentPassingYards") / aPass, 0.85, 1.15)), run: r2(clamp(dg(t, "OpponentRushingYards") / aRush, 0.85, 1.15)), cb: r2(clamp(ypa / aYPA, 0.9, 1.1)) },
      };
    }
    return map;
  } catch { return null; }
}
async function sdioPlayers(key, season, week) {
  // free plan only serves authorized seasons; try current then prior, first non-empty wins
  const tries = week <= 4 ? [season - 1, season, season - 2] : [season, season - 1];
  for (const y of tries) {
    try {
      const rows = await sdioGet(`stats/json/PlayerSeasonStats/${y}REG`, key);
      if (Array.isArray(rows) && rows.length) {
        const aggs = rows.filter((s) => POS_OK[s.Position]).map((s) => ({
          name: s.Name, team: s.Team, pos: s.Position, g: Math.max(1, num(s.Played) || num(s.Games) || 1),
          pAtt: s.PassingAttempts, cmp: s.PassingCompletions, pYd: s.PassingYards, pTD: s.PassingTouchdowns, pINT: s.PassingInterceptions,
          car: s.RushingAttempts, ruYd: s.RushingYards, ruTD: s.RushingTouchdowns,
          tgt: null, rec: s.Receptions, reYd: s.ReceivingYards, reTD: s.ReceivingTouchdowns,
        }));
        const teams = packTeams(aggs);
        const dmap = await sdioDefense(key, y);
        if (dmap) for (const abbr in teams) if (dmap[abbr]) { teams[abbr].pace = dmap[abbr].pace; teams[abbr].def = dmap[abbr].def; }
        return { teams, statsSeason: y };
      }
    } catch { /* try next season */ }
  }
  throw new Error("SDIO players unavailable");
}
async function sdioGames(key, season, week) {
  const sched = await sdioGet(`scores/json/Schedules/${season}REG`, key);
  const wk = sched.filter((g) => g.Week === week && g.HomeTeam && g.AwayTeam && g.HomeTeam !== "BYE" && g.AwayTeam !== "BYE");
  return wk.map((g) => slotGame(g.AwayTeam, g.HomeTeam, g.DateTime || g.Date, num(g.HomeTeamMoneyLine), num(g.AwayTeamMoneyLine), week));
}

/* ---- nflverse (free) sources ---- */
async function nflvPlayers(season) {
  for (const y of [season, season - 1]) {
    try {
      const rows = parseCSV(await text(NFLV_STATS(y)));
      if (!rows.length) continue;
      const m = new Map();
      for (const r of rows) {
        if (r.season_type && r.season_type !== "REG") continue;
        const pos = r.position; if (!POS_OK[pos]) continue;
        const id = r.player_id || r.player_display_name;
        let a = m.get(id);
        if (!a) { a = { name: r.player_display_name || r.player_name, team: r.recent_team, pos, g: 0, pAtt: 0, cmp: 0, pYd: 0, pTD: 0, pINT: 0, car: 0, ruYd: 0, ruTD: 0, tgt: 0, rec: 0, reYd: 0, reTD: 0 }; m.set(id, a); }
        a.team = r.recent_team || a.team;
        a.g += 1;
        a.pAtt += num(r.attempts); a.cmp += num(r.completions); a.pYd += num(r.passing_yards); a.pTD += num(r.passing_tds); a.pINT += num(r.interceptions);
        a.car += num(r.carries); a.ruYd += num(r.rushing_yards); a.ruTD += num(r.rushing_tds);
        a.tgt += num(r.targets); a.rec += num(r.receptions); a.reYd += num(r.receiving_yards); a.reTD += num(r.receiving_tds);
      }
      return { teams: packTeams([...m.values()]), statsSeason: y };
    } catch { /* try next */ }
  }
  throw new Error("nflverse players unavailable");
}
function nflvGamesParsed(rows, season, week) {
  const wk = rows.filter((r) => num(r.season) === season && num(r.week) === week && r.game_type === "REG" && r.away_team && r.home_team);
  return wk.map((r) => slotGame(r.away_team, r.home_team, `${r.gameday}T${r.gametime || "13:00"}:00`, num(r.home_moneyline), num(r.away_moneyline), week));
}
function nflvSeasonWeek(rows) {
  const season = Math.max(...rows.map((r) => num(r.season)));
  const inSeason = rows.filter((r) => num(r.season) === season && r.game_type === "REG");
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = inSeason.filter((r) => r.gameday && r.gameday >= today).map((r) => num(r.week));
  const week = upcoming.length ? Math.min(...upcoming) : Math.max(...inSeason.map((r) => num(r.week)), 1);
  return { season, week };
}

function slotGame(away, home, dtStr, hML, aML, week) {
  const dt = new Date(dtStr);
  const slot = isNaN(+dt) ? `Week ${week}` : dt.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });
  return { away, home, slot, hML: hML || null, aML: aML || null };
}

/* ---- endpoint builders (SDIO first, nflverse fallback) ---- */
async function getPlayers(key) {
  let sw = null;
  if (key) {
    try {
      sw = await sdioSeasonWeek(key);
      const { teams, statsSeason } = await sdioPlayers(key, sw.season, sw.week);
      if (Object.keys(teams).length >= 20) return { season: sw.season, week: sw.week, statsSeason, source: "sportsdataio", teams };
    } catch { /* fall through */ }
  }
  const gamesRows = parseCSV(await text(NFLV_GAMES));
  const nsw = nflvSeasonWeek(gamesRows);
  const { teams, statsSeason } = await nflvPlayers(sw ? sw.season : nsw.season);
  return { season: (sw || nsw).season, week: (sw || nsw).week, statsSeason, source: "nflverse", teams };
}
async function getGames(key) {
  let sw = null;
  if (key) {
    try {
      sw = await sdioSeasonWeek(key);
      const games = await sdioGames(key, sw.season, sw.week);
      if (games.length) return { season: sw.season, week: sw.week, source: "sportsdataio", games };
    } catch { /* fall through */ }
  }
  const rows = parseCSV(await text(NFLV_GAMES));
  const nsw = sw || nflvSeasonWeek(rows);
  return { season: nsw.season, week: nsw.week, source: "nflverse", games: nflvGamesParsed(rows, nsw.season, nsw.week) };
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
    const key = env.SDIO_KEY || "";
    try {
      if (url.pathname === "/players") return json(await getPlayers(key), 21600);
      if (url.pathname === "/games") return json(await getGames(key), 600);
      return json({ ok: true, service: "gridiron-nfl-proxy", hasKey: !!key, endpoints: ["/games", "/players"] }, 60);
    } catch (e) {
      return err(e && e.message || e, 502);
    }
  },
};
