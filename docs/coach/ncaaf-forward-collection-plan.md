# NCAAF forward collection plan — odds, totals, ALTs, injury

**Status:** PREPARED — **not activated**  
**Date:** 2026-10-16 · tip `e6c26f85` research-only  
**Rules:** Do not backfill 2024 injuries with current feeds. Live gate stays false. No purchase/activation from this agent without explicit go-ahead.

## Goals (forward only)

Accumulate timestamped pre-kickoff evidence for **future** reserved-untouched windows (2025+), not to rewrite USED 2024 fixtures:

| Stream | Fields | Timing |
|--------|--------|--------|
| Featured odds | `h2h`, `spreads`, `totals` — two-sided American prices + points | T−24h snap + close (`date≤commence`) |
| ALT odds | `alternate_spreads` (optional `alternate_totals`) — point+price per book | Same snaps |
| Injury / QB | `injuryKnown`, `qbOut`, raw roster statuses | `captureTimestamp < kickoffIso` |

## Provider coverage

| Provider | Odds (ML/spread/total/ALT) | Injury | Historical 2024? | Notes |
|----------|----------------------------|--------|------------------|-------|
| **The Odds API** | Yes — `americanfootball_ncaaf` historical + live | No | Yes (paid) | Existing E2b builder; markets via `NCAAF_E2B_MARKETS` |
| **ESPN public** | No (scores only here) | Current injuries only | **No** historical archive | Forward freeze only (`ncaafPregameInjurySnapshotCollector.ts`) |
| SportsDataIO | Unverified in-repo | Claimed injuries | Unknown | Not configured; timing unproven |
| ScoreTape | — | `captured_ms` docs | Unknown | Not configured; do not purchase here |
| CFBD | Scores/advanced | **No injury family** | — | — |

**Recommended forward stack:** Odds API (prices) + ESPN timestamped injury freezes (injury). Do not substitute live ESPN into past games.

## Credentials required (before activation)

| Secret | Required for | Present in this agent? |
|--------|--------------|------------------------|
| `ODDS_API_KEY` | Historical + live odds (paid plan for historical) | **No** |
| ESPN | Public injury URL | No key (UA only) |
| SportsDataIO / ScoreTape | Optional injury upgrade | **No** |

Activation checklist (human): inject `ODDS_API_KEY` as Cursor secret → new agent run → set `NCAAF_FORWARD_COLLECT=1` (proposed; not wired live) → confirm paid Odds plan includes historical.

## Storage layout (proposed)

```
artifacts/api-server/test/fixtures/
  ncaaf-forward-odds/
    snaps/YYYY-MM-DDThh-mm-ssZ__markets.json   # raw Odds payload + request meta
    manifest.json                              # captureTimestamp, markets, creditCost, eventCount
  ncaaf-pregame-injury-snapshots/              # already exists (forward ESPN freezes)
    espn-cfb-injuries-<iso>.json
    manifest.json
```

Provenance per row: `provider`, `requestUrl` (redact key), `snapshotTimestamp`, `markets`, `regions`, `creditCostEstimate`.  
Join rule: `captureTimestamp < kickoffIso` only; never coerce null injury → false.

## Cost model (Odds API)

Published historical quota: **10 × (#markets) × (#regions)** credits per historical timestamp request  
(source: [The Odds API historical docs](https://the-odds-api.com/historical-odds-data/)).

Assumptions for a forward week of FBS (≈50–70 games, ~8–12 kickoff buckets/week):

| Mode | Markets | Regions | Credits / bucket | ≈ buckets / week | ≈ credits / week |
|------|---------|---------|------------------|------------------|------------------|
| Close only | `h2h,spreads,totals` (3) | `us` (1) | 30 | 10 | **300** |
| Close + ALTs | +`alternate_spreads` (4) | `us` | 40 | 10 | **400** |
| Close + T−24h | 3 markets × 2 snaps | `us` | 30×2 | 10 | **600** |
| Full (T−24h + close + ALT) | 4 × 2 | `us` | 40×2 | 10 | **800** |

Season-scale (≈15 weeks): **~4.5k–12k credits** depending on ALT/T−24h.  
Paid plan floor: historical requires paid subscription (e.g. 20k credits ≈ $30/mo on published tiers — verify current portal pricing before buy).

Live `/odds` (non-historical) is cheaper (1× markets × regions) for same-day forward snaps if acceptable; prefer historical `date=` for reproducible as-of timestamps.

Injury ESPN freezes: **$0** (public); storage ~tens of KB per snap.

## Scripts (ready; not activated)

| Script | Role | Activate? |
|--------|------|-----------|
| `ncaafPhaseE2bClosingLines.py` | Historical closes; `NCAAF_E2B_MARKETS` already supports totals/ALTs | Needs `ODDS_API_KEY` |
| `ncaafPregameInjurySnapshotCollector.ts` | Forward ESPN injury freeze | Safe to run anytime; does not backfill 2024 |
| Proposed: early-snapshot writer into `ncaaf-e2b-early-snapshots/` | Two-sided T−24h | Needs key + cron |

**This document does not start collection.** No cron armed; no secret purchase.

## Explicit non-goals

- Rewriting USED 2024 `injuryKnown` / `qbOut` from today’s ESPN board  
- Enabling product restore / flipping `NCAAF_GAME_LINE_SIM_VALIDATED`  
- E6 sign-off request
