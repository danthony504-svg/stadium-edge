# Exact historical retrieval — 2025 TUNING + FINAL_EVAL / completed 2026

**Status:** Spec + **dry-run manifest complete** — **no paid Odds calls** (`ODDS_API_KEY` unset).  
**Free work done:** ESPN TUNING games (2025 weeks 1–7) vendored. FINAL_EVAL games **not** written to fixtures (untouched).  
**Params / M3 / S2:** Locked in [`ncaaf-model-params-locked.md`](./ncaaf-model-params-locked.md) **before** any close retrieval.

## Credential

| Item | Requirement |
|------|-------------|
| Secret name | `ODDS_API_KEY` (same as api-server / Render) |
| Agent status | **Missing** — only `EXPO_TOKEN` in Cloud Agent secrets |
| Render (authorized server) | **Present** (`oddsKeyConfigured: true` on prod live-steals) — value not exposed |
| Remaining credits | **Unknown** until agent gets the key and runs free `GET /v4/sports` |
| Historical-plan access | **Unconfirmed** (live success ≠ paid historical entitlement) |
| Plan | Any **paid** Odds API plan (historical `/v4/historical/odds` is paid-only; 10× live credit rate) |

Where to inject for this agent: see [`ncaaf-odds-credential-check.md`](./ncaaf-odds-credential-check.md).

## Dry-run manifest (TUNING closes) — verified

Source fixture: `ncaaf-tuning-2025-w1-7-games.json`  
Manifest: `test/fixtures/ncaaf-tuning-closes-dry-run-manifest.json` (+ full bucket list under `/opt/cursor/artifacts/ncaaf-tuning-closes-dry-run-manifest.json`)  
Credit helper: `estimateHistoricalFeaturedCredits(2, 1)` → **20** credits/bucket (`10 × markets × regions`).

| Field | Value |
|-------|--------|
| Games | **471** |
| Unique kickoff minute buckets | **177** (2025-08-23T16:00Z … 2025-10-12T03:59Z) |
| Markets / regions | `h2h,spreads` / `us` |
| Credits per primary request | **20** |
| **Base credits** | **177 × 20 = 3 540** |
| Retry buffer (25%) | **885** |
| **Proposed hard credit cap** | **4 500** |
| FINAL_EVAL this pull | **Excluded / untouched** |
| Paid HTTP | **0** (dry-run only) |

### Plan support / charges / upgrade

| Question | Answer |
|----------|--------|
| Does historical work on free (500/mo)? | **No** — historical is paid-plans only; 500 credits also &lt; 3540 |
| Any paid plan (20K / 100K / 5M / 15M)? | **Yes** — same credit pool; cost is **10×** featured markets×regions |
| Additional charge beyond credits? | **No** — no separate historical SKU fee |
| Upgrade required if already on a paid plan with ≥4500 remaining? | **No** |
| Account remaining credits this turn? | **Unknown** — key unset; no probe |
| Dollar impact if already subscribed | **$0 incremental invoice**; quota value of **3 540** ≈ **$5.31** on 20K/$30 or **$2.09** on 100K/$59 |
| Dollar impact at hard cap 4500 | Quota value ≈ **$6.75** (20K) / **$2.66** (100K) |
| If currently on free | Must upgrade to paid (cheapest public: **$30/mo · 20K credits**) before any historical pull |

Public plan table (the-odds-api.com): Free 500 · **20K $30** · **100K $59** · **5M $119** · **15M $249**.

## Sport / markets / regions

| Field | Value |
|-------|--------|
| Sport key | `americanfootball_ncaaf` |
| Closing markets (ML + spreads restore path) | `h2h,spreads` |
| Optional totals (still blocked without archive) | add `totals` → 177 × 30 = **5 310** base |
| Optional ALTs | `alternate_spreads` via **per-event** historical-event odds (expensive) |
| Regions | `us` (1) for eval backfill |

## Snapshot timing

| Rule | Detail |
|------|--------|
| Primary `date=` | ESPN `kickoffIso` truncated to UTC **minute** (`YYYY-MM-DDTHH:MM:00Z`) |
| API behavior | Closest historical snapshot **≤** `date` (5-minute intervals since Sep 2022) |
| True close | Last snapshot **before** Odds `commence_time` |
| Retry | If `snapshotTimestamp ≥ commence`, re-fetch at `commence` then `previous_timestamp` (cached by date string) |
| Reject | Still post-commence → `snapshot_not_before_commence` → **MISSING_DATA** |
| Not closes | Midday slate snapshots alone |

Script: `ncaafPhaseE2bClosingLines.py` (`NCAAF_E2B_MARKETS`).

## Two-sided odds

Archive extraction **must** retain both sides from the close snapshot (preferred books: DraftKings → FanDuel → BetMGM → …):

`closeMlHome`, `closeMlAway`, `closeSpreadHome`, `closeSpreadAway`, optional spread juice both sides.

| Use | Side rule |
|-----|-----------|
| Engine **M3** | Home ML American → implied prob (existing) |
| Engine **S2** | Home spread line for ATS vs engine |
| **S4** market ATS | Needs two-sided spread juice; else `MISSING_DATA` (do **not** invent −110) |
| Coach CLV R2 | Away ML only from real two-sided early cache — **never** vig-free invent |
| Early T−24h | Optional CLV add-on — **not** in this dry-run / credit cap |

## Market coverage (this authorized pull when approved)

- **In:** `h2h`, `spreads` on bulk historical `/odds`
- **Out:** `totals`, `alternate_spreads` (defer)

## Deduplication

| Layer | Behavior |
|-------|----------|
| Minute bucket | One primary HTTP request per unique kickoff minute (177 for TUNING) |
| Dedupe key | `sport\|historical_asof\|h2h,spreads\|us\|<bucketIso>` (`buildDedupeKey`) |
| File cache | `/opt/cursor/artifacts/ncaaf-e2b-close-snapshots/<bucket>.json` — skip HTTP if present |
| Retry dates | Cached by requested date string; shared across games |

## Missing-data handling

| Condition | Action |
|-----------|--------|
| HTTP ≠ 200 | `api_<status>`; all games in bucket missing; no invented prices |
| No event name match | `no_odds_match` → exclude from M1/S1 `n` |
| Snapshot ≥ commence after retries | `snapshot_not_before_commence` → MISSING_DATA |
| No ML/spread prices | `no_prices` → MISSING_DATA for that market |
| Injury fields | Stay `null` — never coerce to `false` |

## Eval-only isolation (no pregame feature leak)

Closing snapshots are **evaluation inputs only**. They must **not** enter pregame drive-sim / matchup feature vectors or live Coach sim inputs. Allowed: M/S scoring, CLV close reference, settlement audits. See [`ncaaf-model-params-locked.md`](./ncaaf-model-params-locked.md).

## Credit math (historical featured)

`creditsPerBucket = 10 × markets × regions`

| Pull | Games (ESPN count) | Minute buckets | Markets | Credits |
|------|--------------------|----------------|---------|---------|
| **TUNING** 2025 w1–7 (dry-run) | **471** | **177** (exact) | h2h,spreads | **base 3 540 / hard cap 4 500** |
| TUNING + totals | 471 | 177 | h2h,spreads,totals | **177 × 30 = 5 310** base |
| **FINAL_EVAL** 2025 w8–15 | **416** completed (count-only; not vendored) | ~156 est. | h2h,spreads | **~3 120** — **not this turn** |
| Completed 2026 w1–15 | **~455** completed (count-only) | ~171 est. | h2h,spreads | **~3 400** — **not this turn** |

Early T−24h two-sided snaps (Coach CLV R1–R4): **+same order again** if authorized — optional add-on, not required for engine M1–M4 / S1–S2.

## Join / storage layout (when authorized)

```
test/fixtures/
  ncaaf-tuning-2025-w1-7-games.json          # ESPN free — PRESENT
  ncaaf-tuning-closes-dry-run-manifest.json  # Dry-run — PRESENT
  ncaaf-tuning-2025-w1-7-closing-lines.json  # Odds paid — NOT YET
  ncaaf-final-eval-2025-w8plus-games.json    # ESPN free — do not fetch until FINAL_EVAL run
  ncaaf-final-eval-*-closing-lines.json      # Odds paid — NOT YET
```

Never mix TUNING closes into FINAL_EVAL scoring. Never backfill injuries from live ESPN into historical rows.

## Activation steps (next purchase — human approve first)

1. Human approve Odds historical spend: **hard cap 4 500 credits** (base **3 540**) for TUNING `h2h,spreads` only.  
2. Inject `ODDS_API_KEY` into agent/runner.  
3. Set `NCAAF_FORWARD_CREDIT_CAP` / E2b caps ≥ **4500**.  
4. Run closing-lines path against TUNING games only → write `ncaaf-tuning-2025-w1-7-closing-lines.json` (two-sided extract).  
5. Re-score locked M1–M4 / S1–S4 on TUNING with research stamp at **gap scale 1.0** (optional env sweep is secondary).  
6. **Only after** TUNING pass candidates: fetch FINAL_EVAL ESPN+Odds and score once — no retune.

## Free vs paid this turn

| Work | Status |
|------|--------|
| ESPN TUNING games | **Done** (471) |
| Dry-run request/credit manifest | **Done** (3540 base / 4500 cap) |
| Model params + M3/S2 lock | **Done** |
| Team-strength / matchup diag on TUNING | **Done** (score-only; pre-lock) |
| Margin-gap scale research hook (default no-op) | **Done** |
| Odds closes TUNING / FINAL_EVAL | **Blocked** — needs key + spend approval |
| Gate / production OTA | **Unchanged** (blocked / frozen) |
