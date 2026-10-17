# NCAAF historical data availability — injury, totals, ALT prices

**Captured:** 2026-10-16 · branch `cursor/ncaaf-phase-e-restore-8b51` (updated after odds-api branch sample audit)  
**Rule:** Never substitute **current** live feeds into **2024** holdout fixtures.

## Closing lines (spreads + ML) — PRESENT

| Field | Coverage | Provenance |
|-------|----------|------------|
| `closeSpreadHome`, `closeMlHome` | 842 matched / 774 with full prices / 770 joined holdout | Odds API historical `date=kickoff`, markets **`h2h,spreads` only** — PR 737 / `7fbf065a`, archive `ncaaf-phase-e-closing-lines.json` |
| Snapshot timing | `closeSnapshotTimestamp` ≤ commence | Closing definition documented in archive `closingDefinition` |
| `ODDS_API_KEY` in this agent | **unset** | Cannot refetch or extend markets |

## Closing totals — ABSENT

| Item | Status |
|------|--------|
| `closeTotal` in E2b archive | **Not present** (schema has no totals field) |
| Historical Odds samples in repo | On `origin/cursor/odds-api-access-5cb3`, `ncaaf-historical-odds-2024-*.json` are **extracted** h2h/spreads rows (`closeSpreadHome` / `closeMlHome` only) — no `totals` market payloads |
| Path to obtain | Re-run `ncaafPhaseE2bClosingLines.py` with `NCAAF_E2B_MARKETS=h2h,spreads,totals` when `ODDS_API_KEY` is injected; join to ESPN finals |
| Substitution forbidden | Live `/sports/odds` or current totals **must not** be written into 2024 rows |

## Posted ALT spread prices — ABSENT

| Item | Status |
|------|--------|
| `alternate_spreads` in E2b archive | **Not present** |
| Historical Odds samples | Same extracted fixtures — no `alternate_spreads` / `alternate_totals` keys in tree walk |
| Holdout ALT evaluation | Engine cover rates at **synthetic** lines (fixed away +3.5…+21, close±3.5) vs finals only — **not** CLV vs posted ALT juice |
| Path to obtain | Historical Odds with `markets=…,alternate_spreads` at pre-kickoff `date=`; store point+price per book |
| Substitution forbidden | Live ALT boards must not backfill 2024 |

## Early (T−24h) two-sided prices — ABSENT in this agent

| Item | Status |
|------|--------|
| `/opt/cursor/artifacts/ncaaf-e2b-early-snapshots` | **Empty** (0 files) |
| Fixture `ncaaf-phase-e-selection-prices.json` | Home-only early ML/spread (705 games); provenance `vendored from a2f59a9c true-clv T-24h CSV` |
| Coach CLV impact | Under locked R1–R2, fixture cannot supply away ML; C1 (n≥50) unreachable without early cache or keyed Odds refetch |

## Pre-kickoff injury / QB — INSUFFICIENT for 2024 holdout

| Source | Historical 2024 coverage | Notes |
|--------|--------------------------|-------|
| E2b archive `injuryKnown` / `qbOut` | **842/842 null** | Columns exist; values never populated |
| ESPN public injuries | **Current season only** | Live probe returns today's teams — not a 2024 archive |
| `ncaaf-pregame-injury-snapshots/` (odds-api branch) | **1 snapshot @ 2026-10-14** | Forward-looking draft capture; **must not** join to 2024 games |
| SportsDataIO / ScoreTape | **Not configured** | Timing claims unverified; do not purchase from this agent |
| CFBD | No injury family | — |

**E4 dependency (unchanged):** multiple snapshots with `captureTimestamp < kickoffIso` for holdout games, joined as `injuryKnown=true|null` (never coerce null→false), then unknown segment mean \|edge\| ≤ known.

Forward collector: `artifacts/api-server/scripts/ncaafPregameInjurySnapshotCollector.ts` (ESPN live freeze with explicit capture timestamp). Useful for **future** slates only.

## Credential probe (this Cloud Agent)

| Secret | Status |
|--------|--------|
| `ODDS_API_KEY` | **Missing** |
| `EXPO_TOKEN` | Present (unrelated) |
| SportsDataIO / ScoreTape | Missing |

## Summary

| Data class | Holdout-ready? |
|------------|----------------|
| Close ML + close spread | **Yes** (vendored) |
| Close totals | **No** |
| Posted ALT prices | **No** |
| Pre-kickoff injury 2024 | **No** |
