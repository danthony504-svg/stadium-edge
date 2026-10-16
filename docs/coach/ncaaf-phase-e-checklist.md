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
| Coach pick CLV | **COMPUTED_NO_PASS_LABEL** (200 picks; mean ML CLV −0.0057) |
| Closing spread ATS Brier | **0.311 FAIL vs coin** (n=754) — see market-families report |
| Injury segments | **INSUFFICIENT_DATA** |

## Criterion board

| # | Criterion | Status | Notes |
|---|-----------|--------|-------|
| E1 | Sensitivity ±3 ppg / QB-out ≥2pp | **PASS (unit)** | Soft-rate PPD unit test corrected |
| E2a | Outcome calibration vs coin | **PASS** | Primary seed 20241015, 10k sims |
| E2b | Closing-line soft gates | **PASS_SOFT_GATES_ONLY** | Not a CLV PASS |
| E2b | Coach pick CLV | **COMPUTED_NO_PASS_LABEL** | Needs agreed tolerance + human review |
| E2b | Closing spread ATS | **FAIL** | Brier 0.311 > 0.25 — restore blocked |
| E3 | Exact-line binder | **PASS (unit)** | `gameSimQualityGates.test.ts` |
| E4 | Injury conservatism | **INSUFFICIENT_DATA** | Archive `injuryKnown` all null |
| E5 | Props / other-sport P0 regressions | **PASS** | Re-run green on this branch |
| E6 | Human sign-off | **OPEN** | Required after E2b/E4 PASS |

**Restore readiness:** **NO**. Live gate stays false. Outstanding: CLV PASS criteria, closing-spread calibration fix + remeasure, injury evidence, human sign-off. Closing totals / posted ALT prices missing for those market CLVs.

## Unavailable data — exact dependencies

| Gap | Dependency |
|-----|------------|
| E2b CLV PASS | Agreed numeric CLV tolerance recorded as PASS; Coach pick CLV re-reviewed |
| Closing spread FAIL | Model/data fix so home ATS Brier &lt; 0.25 on same archive, then re-run `ncaafPhaseEMarketFamilies.ts` |
| Closing totals / ALT prices | Odds historical totals + alt lines in frozen archive (not present today) |
| E4 injury / QB | Non-null `injuryKnown` (+ optional `qbOut`) pre-kickoff; null ≠ false |
| E6 | Named approver + UTC date + commit SHA on flag-only PR |

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
