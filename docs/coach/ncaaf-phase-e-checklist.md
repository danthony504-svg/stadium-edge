# NCAAF Phase E — acceptance checklist (do not flip P0)

**Holdout:** ESPN scoreboard 2023–2024 (`test/fixtures/ncaaf-phase-e-games.json`, 1739 games).  
**Live engine:** `ppg-per-drive-v1` (isolated from research).  
**Research engine (offline opt-in):** `ppg-per-drive-v1.1-research` — residual + shrink; see [`ncaaf-engine-isolation.md`](./ncaaf-engine-isolation.md).  
**Form inputs:** venue split blended with L10 via `blendVenueAndL10` (production `footballGameSimInputs` parity).  
**Gate:** `NCAAF_GAME_LINE_SIM_VALIDATED` stays `false` until every restore criterion is PASS + human sign-off.  
**Holdout:** 2024 evaluated windows are **USED**; further tuning needs reserved 2025+ data.

**Restoration candidate summary:** [`ncaaf-restoration-candidate.md`](./ncaaf-restoration-candidate.md).  
**Failure analysis:** [`ncaaf-phase-e-failure-analysis.json`](../../artifacts/api-server/test/fixtures/ncaaf-phase-e-failure-analysis.json).  
**Forward collection (not activated):** [`ncaaf-forward-collection-plan.md`](./ncaaf-forward-collection-plan.md).

## Latest calibration report (2024 USED holdout, research path @ e6c26f85)

Source: `artifacts/api-server/test/fixtures/ncaaf-phase-e-calibration-report.json`  
Generated: **2026-10-16**. Research engine stamp at evaluation: `ppg-per-drive-v1.1-research` (live remains `ppg-per-drive-v1`).

The 2026-10-14 E2a **PASS** is **WITHDRAWN**. That report used PPG fed as PPD + ×0.48 college scale. `priorE2aClaim.restored` stays `false`. Soft-rate unit checks that used ppd 12/15/20 inherited that mismatch and were corrected to true PPD (2.5/3.5/4.5) without lowering +3 ppg / QB-out thresholds.

| Metric | Value |
|--------|-------|
| Holdout games scored | 865 (6 skipped thin form) |
| Sims / game | **10000** |
| Calibration seed | **20241015** (primary of `20241015, 7, 42, 99, 123456789`) |
| Brier (engine ML) | **0.1996** |
| Brier (coin) | 0.250 |
| ECE (10-bin) | **0.0462** |
| meanP / meanY (home ML) | **0.6095 / 0.6370** (bias ≈ **−0.027**) |
| Official dog cohort (0.45, 0.55) away +7.5 | **0.6788** (n=165) |
| E2a (`E2_outcomeVsCoin`) | **PASS** |
| Close soft gates | **PASS_SOFT_GATES_ONLY** |
| Coach pick CLV | **FAIL_LOCKED_CRITERIA** (nMl=15 under R1–R4; mean −0.004; need early cache for C1) |
| Closing spread ATS (untouched) | **Brier 0.264 FAIL vs coin** — settlement CLEARED; residual fixed bias; discrimination weak |
| Injury segments | **INSUFFICIENT_DATA** |

## Criterion board

| # | Criterion | Status | Notes |
|---|-----------|--------|-------|
| E1 | Sensitivity ±3 ppg / QB-out ≥2pp | **PASS (unit)** | Soft-rate PPD unit test corrected |
| E2a | Outcome calibration vs coin | **PASS** | Primary seed 20241015, 10k sims, v1.1 |
| E2b | Closing-line soft gates | **PASS_SOFT_GATES_ONLY** | Not a CLV PASS |
| E2b | Coach pick CLV | **FAIL_LOCKED_CRITERIA** | C1–C6 locked; R1–R4 applied; early cache empty → C1 fail |
| E2b | Closing spread ATS | **FAIL vs coin** (untouched Brier 0.264) | Settlement CLEARED; v1.1 residual locked on pre-cutoff; OPEN_MODEL discrimination |
| E3 | Exact-line binder | **PASS (unit)** | `gameSimQualityGates.test.ts` |
| E4 | Injury conservatism | **INSUFFICIENT_DATA** | 2024 labels absent; forward ESPN snaps must not backfill |
| E5 | Props / other-sport P0 regressions | **PASS** | Re-run green on this branch |
| E6 | Human sign-off | **OPEN — not requested** | Blockers remain |

**Restore readiness:** **NO**. Per-market: ML beats coin not market (CLV fail); spreads fail coin; totals/ALTs missing closes. Live gate stays false.

## Unavailable data — exact dependencies

| Gap | Dependency |
|-----|------------|
| E2b CLV PASS | Meet locked C1–C6 under R1–R4; need Odds early two-sided snaps (`ODDS_API_KEY`); do not loosen C2 |
| Closing spread FAIL | Stronger ATS discrimination (Brier &lt; coin) — residual/bias fix insufficient |
| Closing totals / ALT prices | Odds historical with `NCAAF_E2B_MARKETS=h2h,spreads,totals,alternate_spreads` when `ODDS_API_KEY` set |
| E4 injury / QB | Snapshots with `captureTimestamp < kickoff` for holdout games; never coerce null→false |
| E6 | Named approver + UTC date + commit SHA on flag-only PR — **after** market blockers clear |

## Commands

```bash
cd artifacts/api-server
NCAAF_PHASE_E_SIMS=10000 node --import ./test/register-hooks.mjs \
  ./scripts/ncaafPhaseEHoldoutCalibration.ts
NCAAF_PHASE_E_SIMS=10000 node --import ./test/register-hooks.mjs \
  ./scripts/ncaafPhaseESpreadSettlementAudit.ts
NCAAF_PHASE_E_SIMS=2500 node --import ./test/register-hooks.mjs \
  ./scripts/ncaafPhaseESpreadMarginDiag.ts
NCAAF_PHASE_E_SIMS=10000 node --import ./test/register-hooks.mjs \
  ./scripts/ncaafPhaseEMarketFamilies.ts
NCAAF_PHASE_E_SIMS=10000 node --import ./test/register-hooks.mjs \
  ./scripts/ncaafPhaseECoachPickClv.ts

# Isolated Coach (research unlock only — does not flip product gate)
cd ../stadium-mobile
NCAAF_ISOLATED_ASK="3 leg college" NCAAF_ISOLATED_LEGS=3 \
  node --import ./test/register-hooks.mjs ./scripts/ncaafIsolatedCoachDelivery.mjs
```
