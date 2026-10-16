# NCAAF forward collection plan — odds, totals, ALTs, injury

**Status:** PREPARED locally (collector + tests) — **not activated**  
**Date:** 2026-10-16 · tip after forward-collector prepare  
**Rules:** No paid retrieval / no deploy / no OTA this turn. Never backfill historical injuries with current feeds. Live gate false.

## Credential (reuse; never expose)

| Source | Status |
|--------|--------|
| Cloud Agent secrets | **Only `EXPO_TOKEN` injected** — `ODDS_API_KEY` **not** in agent secret list |
| api-server production pattern | `process.env.ODDS_API_KEY` (routes `odds.ts` / `props.ts` / `golf.ts`) |
| Collector | Same env var name; reports `ODDS_API_KEY:set\|unset` only — **never logs the value** |

Reuse the existing Render/Cursor `ODDS_API_KEY` secret when activating. Do not paste keys into chat or fixtures.

## Local prepare artifacts

| Path | Role |
|------|------|
| `src/lib/ncaafForwardCollector.ts` | Credit math, dedupe keys, ledger, activation gates |
| `scripts/ncaafForwardCollector.ts` | Dry-run CLI (writes timestamped placeholder + manifest) |
| `test/ncaafForwardCollector.test.ts` | Unit tests (no network) |
| `test/fixtures/ncaaf-forward-odds/` | Timestamped dry-run snaps + `manifest.json` |

Activation requires **all** of: `NCAAF_FORWARD_ACTIVATE=1`, `NCAAF_FORWARD_CREDIT_CAP>0`, `ODDS_API_KEY` set. Prepare script still refuses paid fetch even if those are set.

## Exact schedule × cost reconciliation

**Sport:** `americanfootball_ncaaf` only  
**Featured markets:** `h2h,spreads,totals` (3)  
**ALT markets:** `alternate_spreads` (per-event; off by default)  
**Regions (forward default):** `us` (1) — note production board often uses `us,us2` (2× live cost)

| Endpoint | Formula | Credits / call (3 mkts × 1 region) |
|----------|---------|-------------------------------------|
| Live `/odds` (upcoming) | `markets × regions` | **3** |
| Historical `/odds` (as-of) | `10 × markets × regions` | **30** |
| Historical event-odds (ALTs) | `10 × markets × regions × events` | **10** per event per ALT market |

### Default forward week (authorized live polls only)

| Item | Count | Credits |
|------|-------|---------|
| Live featured polls | 16 / week (≈4× Fri–Sun + 1× Mon–Thu) | 16 × 3 = **48** |
| Historical T−24h / close | 0 | 0 |
| ALT event historical | 0 | 0 |
| ESPN injury freezes | 14 (2×/day) | **0** |
| **Total** | | **≈48 credits/week** |

### Prior 300–800 band (reconciled)

That range assumed **historical** featured snaps (~10–20 buckets/week × 30 credits):

| Historical buckets / week | Credits |
|---------------------------|---------|
| 10 (close-only style) | 300 |
| 20 (T−24h + close) | **600** |
| + ALTs on ~20 events × 10 | +200 → **~800** |

So 300–800 was a **historical-heavy** estimate, not the default forward live schedule. Enabling historical backfill or ALTs is an **incremental** decision:

| Add-on (per week) | Incremental credits |
|-------------------|---------------------|
| +10 historical close buckets | +300 |
| +10 historical T−24h buckets | +300 |
| +20 ALT event historical pulls | +200 |
| Switch live regions to `us,us2` | live polls ×2 (48→96) |

Hard cap: `NCAAF_FORWARD_CREDIT_CAP` enforced in-process before any Odds call.

## Activation / deployment steps (before collection)

1. Confirm human approval for paid Odds spend and cap size.  
2. Ensure `ODDS_API_KEY` is available to the runner (Render secret or Cursor secret) — same as api-server.  
3. Set `NCAAF_FORWARD_CREDIT_CAP` (start small, e.g. 100).  
4. Dry-run: `node --import ./test/register-hooks.mjs ./scripts/ncaafForwardCollector.ts` (credits charged = 0).  
5. Only then set `NCAAF_FORWARD_ACTIVATE=1` on a dedicated activate runner (not yet written to fetch).  
6. **Do not** deploy api-server or publish OTA to “turn on” collection — collector is offline/scripted.  
7. Keep `NCAAF_GAME_LINE_SIM_VALIDATED=false`.  

**This turn stops at step 4.**

## Storage

```
artifacts/api-server/test/fixtures/ncaaf-forward-odds/
  dry-run-<iso>.json          # timestamped; events=[] until activate
  manifest.json               # dedupeKeys, weeklyCostModel, activationSteps
ncaaf-pregame-injury-snapshots/  # ESPN freezes (separate; free)
```

Dedupe key: `sport|mode|marketsSorted|regionsSorted|minuteBucketIso`.

## Reserved eval data

See [`ncaaf-reserved-eval-acceptance-criteria.md`](./ncaaf-reserved-eval-acceptance-criteria.md).  
2025 + completed 2026 Odds historical **can** supply a new set after authorized retrieval; criteria locked before results; tuning vs FINAL_EVAL split fixed.
