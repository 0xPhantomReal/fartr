# Gridiron Sim — live NFL data proxy (OPTIONAL)

**You do not need this to use the site.** Out of the box the simulator already
pulls the **real current-week slate from ESPN** (no key, no server) and runs it
against a baked-in 32-team usage dataset. Every game simulates.

`worker.js` is an **optional upgrade**: deploy it only if you want live
*season-to-date* player usage from SportsDataIO instead of the season baseline.

## Why a proxy is needed
SportsDataIO requires a secret key and sends **no CORS header**, so the browser
can't call it directly. The Worker holds the key as a secret, adds CORS, and
normalizes the data into the exact shape the sim uses. It also caches responses
(players 6h, games 10m) to protect the free-plan quota.

## Data chain (SportsDataIO first, free backup)
- **players**: SportsDataIO `PlayerSeasonStats` → nflverse `player_stats` CSV
- **games**:   SportsDataIO `Schedules`         → nflverse `nfldata/games.csv`

If SDIO is down, out of credits, or a season is unauthorized, it silently falls
through to the free nflverse feeds. If the Worker itself is unreachable, the
site falls back to its curated slate.

## Deploy (no local tooling)
1. Cloudflare dashboard → **Workers & Pages → Create → Worker**.
2. Paste the contents of `worker.js`, click **Deploy**.
3. Open the Worker → **Settings → Variables and Secrets** → add a **Secret**:
   - name: `SDIO_KEY`
   - value: your SportsDataIO key
   (Without the secret it still runs on the free nflverse backup.)
4. Copy the Worker URL, e.g. `https://gridiron-nfl-proxy.<you>.workers.dev`.
5. In the site, click **⚙** (top-right), paste the URL, **Save**. It's stored in
   your browser — no rebuild needed. Or set `DEFAULT_PROXY` in
   `src/pages/Index.tsx` to bake it in for everyone.

## Endpoints
- `GET /`         health + resolved season/week/source
- `GET /games`    `{ season, week, source, games:[{away,home,slot,hML,aML}] }`
- `GET /players`  `{ season, week, source, teams:{ ABBR:{abbr,pace,def,players:[…]} } }`

## Security note
Rotate any key that was ever pasted into a chat. The key lives **only** as the
Worker secret — never in the site bundle.
