# Render vs tip verification + E2E prop traces

**Date:** 2026-10-16  
**Constraints honored:** `NCAAF_GAME_LINE_SIM_VALIDATED=false`, voice paused, production OTA frozen, **no publish / no deploy**.

## 1. Live Render vs previously verified pack

| Surface | Value |
|---------|--------|
| Live `/api/healthz` `deploymentSha` | `ddeb4733348b98d7112748edc19c7e06fc6fc99a` |
| Live NFL `POST /sports/simulate/game-outcome` `engineVersion` | **`ppg-per-drive-v1`** |
| Live `simModel` / label | `nfl-drive` / `NFL/NCAAF drive-by-drive (ppg-per-drive-v1)` |
| Previously verified pack | `1f9cc04a` (`FOOTBALL_DRIVE_ENGINE_VERSION = "ppg-per-drive-v1"`) |
| Holdout pin | `014ec192` |
| Pack ancestor of live Render? | **Yes** (`1f9cc04a` ⊂ `ddeb4733`) |

**Verdict:** Live Render **is** on the verified football-unit engine stamp. Earlier tip reconcile text that said “live server missing soft rates / stamp” is **stale for today’s Render** — confirm via healthz + game-outcome every time.

Artifacts: `/opt/cursor/artifacts/render-healthz.json`, `/opt/cursor/artifacts/live-game-outcome-stamp.json`.

## 2. Deployed code vs local branch (distinguish clearly)

| Ref | SHA | Role |
|-----|-----|------|
| **Live Render (server)** | `ddeb4733` | Serving API / sims |
| **Production OTA (mobile)** | `b666165e` (freeze file) | Installed JS on production channel |
| **Local tip branch** | `540c5a28` (`cursor/prop-defense-index-perside-8b51`) | Unshipped Coach/mobile work |

These three are **divergent lineages** (neither Render nor tip is an ancestor of the other; OTA tip also diverged from Render).

### What live Render has that tip **lacks** (deploying tip server = **regression**)

- `footballDriveMatchup.ts` soft rates + PPG→drives + defense tilt on drive means  
- `gameSimEngineVersion.ts` / response `engineVersion: "ppg-per-drive-v1"`  
- Mobile (on Render tree) `gameDrawEngineAccepted` stamp reject  

Diff stat tip←Render sportSim: **−1324 / +91** (tip deletes the pack).

### What tip has that live Render / prod OTA **lack**

- Per-opponent prop `defenseIndex` (`propOpponentDefenseKey`, HTTP batch split by opp)  
- `propContextPipeline` channel split + FB wx/injury **proposals** (not live in MC)  
- College P0 honesty early-exit copy path (gate still false on both)

### What prod OTA mobile lacks vs Render mobile tree

- **Stamp reject** (`gameSimEngineVersion.ts`) — missing on `b666165e` and on tip  
- Per-opp defenseIndex — missing on prod OTA (only on tip)

### NCAAF / voice / freeze

- Gate `false` on tip **and** on Render tree  
- `.ota-production-freeze` still armed (prod OTA `b666165e`)  
- Voice remains paused (no publish)

## 3. Regression explanation

1. **If tip `api-server` were deployed as-is:** football game sims would fall back to **hard-capped** `nfl-drive` (0.42/0.28) and **lose** `engineVersion` stamping — a clear regression vs live `ppg-per-drive-v1`.  
2. **If tip mobile OTA’d alone against live Render:** game draws would still carry `ppg-per-drive-v1`, but tip/prod-OTA clients **do not reject** wrong/missing stamps (Render mobile tree would). Prop path gains per-opp defense keys (good) but inherits server dist-cache gap below.  
3. **Not a live-server regression vs pack:** Render already matches verified stamp.

## 4. E2E prop traces (HOU @ JAX)

**Game (REAL-DATA):** Houston Texans @ Jacksonville Jaguars (`awayTeamId=34`, `homeTeamId=30`).

**Label policy**

| Tag | Meaning |
|-----|---------|
| **REAL-DATA** | ESPN team ids, `/sports/team-defense` packs, athleteIds, player history, live engine |
| **SYNTHETIC** | Lines, ALT rungs, intentional bug mis-wire, omitted defense, NFL `weatherImpact` probe |

### Defense indices (REAL-DATA packs → client index)

| Who | Faces | rush_yds | pass_yds |
|-----|-------|----------|----------|
| Home players (JAX) | HOU D | 0.88 | ~1.06 |
| Away players (HOU) | JAX D | 0.88 | 1.14 |

Keys: `…@@opp:34` vs `…@@opp:30` (must never share).

### Traces (live `POST /sports/simulate/props`, deep)

| Trace | Data tags | Result (abbrev) |
|-------|-----------|-----------------|
| Home RB/QB vs away D | REAL athlete+D / SYNTHETIC lines+ALT | Etienne mean **36.62** hit 0.059; Lawrence **248.42** hit 0.595; ALTs via `lineHitRatesBySide.Over` |
| Away RB/QB vs home D | same | Mixon / Stroud graded with home D index |
| BUG: home players + home D | SYNTHETIC mis-wire | Rush identical (both packs rush_yds=0.88). Pass should differ but see §5 cache |
| MISSING defenseIndex | REAL history / SYNTHETIC omit | Etienne mean **42.53** hit 0.108 (higher than with D — defense applied on miss) |
| REPLACEMENT Brian Thomas Jr. | REAL athlete / SYNTHETIC line | Same opp key as home; mean 20.09; ALTs present |
| NFL weatherImpact −0.35 vs omit | SYNTHETIC | **no_distribution_change** (server strips non-MLB weather) |

Full JSON: `/opt/cursor/artifacts/e2e-prop-traces-live.json`.

### Double-count protection

| Layer | Evidence |
|-------|----------|
| NFL weather in prop MC | Live: identical hit/mean with vs without `weatherImpact` |
| Tip post-sim opp-D tilt skip | Unit: `propDefenseIndexTwoTeam.test.ts` (ALT/replacement same key) |
| Tip FB wx / key-injury proposals | Unit: skip when vs-opp n≥3 or Opp Shift owns fingerprint — **not live in MC** |
| Opp D in MC + post-sim | Tip keys `projectionDefenseKeys` per opponent after successful batch |

## 5. Live server gap: dist cache ignores defenseIndex

Sensitivity probe (`/opt/cursor/artifacts/defense-index-sensitivity-live.json`):

| Request | defenseIndex | meanProjection | cached | draws |
|---------|--------------|----------------|--------|-------|
| boost | pass 1.14 | **261.94** | false | 3000 |
| suppress | pass 0.88 | **261.94** (wrong) | true | 0 |
| omit | null | **240.20** | false | 3001 |

`propDistributionCacheKey` fingerprints history only — **not** `defenseIndex`. First draw bakes one index into samples; later opposite-side index for the **same** player/history reuses it.

**Impact on tip per-opp fix:** Different players on each side still get separate cache entries (OK for two-team boards). Same player under two opponent contexts (re-sim, bug paths, shared dist groups) can **cross-contaminate**. Preview gap: include defenseIndex (or matchup factor) in dist key before relying on per-opp batches under load.

## 6. Cold / warm Coach scan timing (network + sims)

Proxy for one NFL game both sides (not full chat/`buildParlay` — no auth ticket build here):

| Pass | Wall ms | Notes |
|------|---------|-------|
| healthz (first in session) | ~3100 | cold Render wake earlier in run |
| Scan pass1 | **~560** | healthz+games+2×defense+2 prop batches+game-outcome (warm process) |
| Scan pass2 | **~535** | same subset |

Prop batch server `propSimElapsedMs` often **&lt;15ms** once ctx/dist caches are hot. Full Coach board also pays odds/props board/injuries/ESPN enrich — expect multi-second cold on device; this proxy is API+sim only.

## 7. Remaining gaps before **preview** publication

Do **not** publish yet. Ordered gaps:

1. **Do not deploy tip `api-server`** until football-unit pack is merged onto tip (or tip rebased onto `ddeb4733`) — else regress stamp/engine.  
2. **Mobile stamp reject** (`gameSimEngineVersion` / `gameDrawEngineAccepted`) — on Render tree, missing on tip + prod OTA; add after confirming live stamp (already `ppg-per-drive-v1`).  
3. **Prop dist cache key + defenseIndex** on server — fix before trusting per-opp defense under cache.  
4. Ship tip **mobile-only** per-opp defenseIndex against live Render only after (3) or with acceptance of cache caveat.  
5. Keep **`NCAAF_GAME_LINE_SIM_VALIDATED=false`** until Phase E evidence on the **shipping** stamp (see `docs/coach/ncaaf-game-line-missing-evidence.md`).  
6. Voice stays paused; production freeze stays armed.

## 8. Tip reconcile correction

Update `docs/coach/ppg-per-drive-v1-tip-reconcile.md`: **live Render now has the pack**; **tip branch** is what is missing soft rates/stamp. Do not restore blindly onto tip — rebase/port with fresh holdout.
