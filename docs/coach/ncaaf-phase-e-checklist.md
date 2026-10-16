# NCAAF Phase E — acceptance checklist (do not flip P0)

**Holdout:** ESPN scoreboard 2023–2024 (`test/fixtures/ncaaf-phase-e-games.json`, 1739 games).  
**Engine under test:** coach `nfl-drive` (`ncaafPhaseEHoldoutCalibration.ts`) stamp **`ppg-per-drive-v1`**.  
**Form inputs:** venue split blended with L10 via `blendVenueAndL10` (production `footballGameSimInputs` parity).  
**Gate:** `NCAAF_GAME_LINE_SIM_VALIDATED` stays `false` until every restore criterion is PASS + human sign-off.

**Restoration candidate summary:** [`ncaaf-restoration-candidate.md`](./ncaaf-restoration-candidate.md).

## Latest calibration report (2024 holdout, `ppg-per-drive-v1`)

Source: `artifacts/api-server/test/fixtures/ncaaf-phase-e-calibration-report.json`  
Generated: **2026-10-16T19:54:31.150Z** (full 5-seed re-run on this branch). Engine: `nfl-drive:ppg-per-drive-v1`.

The 2026-10-14 E2a **PASS** is **WITHDRAWN**. That report used PPG fed as PPD + ×0.48 college scale. `priorE2aClaim.restored` stays `false`. Soft-rate unit checks that used ppd 12/15/20 inherited that mismatch and were corrected to true PPD (2.5/3.5/4.5) without lowering +3 ppg / QB-out thresholds.

| Metric | Value |
|--------|-------|
| Holdout games scored | 865 (6 skipped thin form) |
| Sims / game | **10000** |
| Calibration seed | **20241015** (primary of `20241015, 7, 42, 99, 123456789`) |
| Brier (engine) | **0.19860** |
| Brier (coin) | 0.250 |
| ECE (10-bin) | **0.05296** |
| meanP / meanY (home ML) | **0.67397 / 0.63699** (bias ≈ **+0.037**) |
| Official dog cohort (0.45, 0.55) away +7.5 | **0.6757** (n=111) |
| Dog-cover range across five seeds | **0.6757–0.6990** |
| E2a (`E2_outcomeVsCoin`) | **PASS** |
| Close soft gates | **PASS_SOFT_GATES_ONLY** (n=770) |
| Coach pick CLV | **FAIL_LOCKED_CRITERIA** (200 picks; mean ML CLV −0.0057; require ≥0) |
| Closing spread ATS Brier | **0.311 FAIL vs coin** (n=754) — see market-families report |
| Injury segments | **INSUFFICIENT_DATA** |

## Criterion board

| # | Criterion | Status | Notes |
|---|-----------|--------|-------|
| E1 | Sensitivity ±3 ppg / QB-out ≥2pp | **PASS (unit)** | Soft-rate PPD unit test corrected |
| E2a | Outcome calibration vs coin | **PASS** | Primary seed 20241015, 10k sims |
| E2b | Closing-line soft gates | **PASS_SOFT_GATES_ONLY** | Not a CLV PASS |
| E2b | Coach pick CLV | **FAIL_LOCKED_CRITERIA** | Require mean CLV ≥ 0 + pctBeat≥0.45; measured −0.0057 / 0.348 — see `ncaaf-e2b-clv-acceptance-criteria.md` |
| E2b | Closing spread ATS | **FAIL vs coin** (untouched Brier 0.284) | Settlement/sign/push/extraction **CLEARED**; OPEN_MODEL overconfidence |
| E3 | Exact-line binder | **PASS (unit)** | `gameSimQualityGates.test.ts` |
| E4 | Injury conservatism | **INSUFFICIENT_DATA** | 2024 labels absent; forward ESPN snaps must not backfill |
| E5 | Props / other-sport P0 regressions | **PASS** | Re-run green on this branch |
| E6 | Human sign-off | **OPEN — not requested** | Blockers remain |

**Restore readiness:** **NO**. Per-market: ML beats coin not market (CLV fail); spreads fail coin; totals/ALTs missing closes. Live gate stays false.

## Unavailable data — exact dependencies

| Gap | Dependency |
|-----|------------|
| E2b CLV PASS | Meet locked C1–C6 (`meanClv ≥ 0`); do not loosen floor |
| Closing spread FAIL | Model calibration so untouched ATS Brier &lt; coin (settlement already audited) |
| Closing totals / ALT prices | Odds historical with `NCAAF_E2B_MARKETS=h2h,spreads,totals,alternate_spreads` when `ODDS_API_KEY` set |
| E4 injury / QB | Snapshots with `captureTimestamp < kickoff` for holdout games; never coerce null→false |
| E6 | Named approver + UTC date + commit SHA on flag-only PR — **after** market blockers clear |

## Commands

```bash
cd artifacts/api-server
NCAAF_PHASE_E_SIMS=10000 node --import ./test/register-hooks.mjs \
  ./scripts/ncaafPhaseEHoldoutCalibration.ts
NCAAF_PHASE_E_SIMS=10000 node --import ./test/register-hooks.mjs \
  ./scripts/ncaafPhaseEMarketFamilies.ts
NCAAF_PHASE_E_SIMS=10000 node --import ./test/register-hooks.mjs \
  ./scripts/ncaafPhaseECoachPickClv.ts

# Isolated Coach (research unlock only — does not flip product gate)
cd ../stadium-mobile
NCAAF_ISOLATED_ASK="3 leg college" NCAAF_ISOLATED_LEGS=3 \
  node --import ./test/register-hooks.mjs ./scripts/ncaafIsolatedCoachDelivery.mjs
```
