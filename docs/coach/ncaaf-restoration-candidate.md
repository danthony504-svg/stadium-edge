# NCAAF restoration candidate — evidence pack

**Branch:** `cursor/ncaaf-phase-e-restore-8b51`  
**Engine under test:** `nfl-drive:ppg-per-drive-v1` (verified live Render `e607f131`)  
**Product gate:** `NCAAF_GAME_LINE_SIM_VALIDATED = false` — **do not flip**  
**Ops:** No production publish/deploy; voice paused; production OTA freeze armed.

## Verdict: restore readiness **NO**

| Criterion | Status | Evidence |
|-----------|--------|----------|
| E1 sensitivity | **PASS** | `ncaafGameLineSimValidation.test.ts` — +3 ppg / QB-out ≥2pp; soft-rate unit test corrected for true PPD |
| E2a outcome vs coin | **PASS** | 865 games, 10k sims, seed 20241015: Brier 0.19860, ECE 0.05296, bias +0.0370, dog +7.5 cover 0.6757 (n=111); 5-seed dog range 0.6757–0.6990 |
| E2b soft gates | **PASS_SOFT_GATES_ONLY** | n=770; market Brier 0.1768; engine Brier 0.2165; mean(engine−market) +0.0366 |
| E2b Coach pick CLV | **COMPUTED_NO_PASS_LABEL** | 200 picks (112H/88A); mean ML CLV −0.0057; hit 0.497; **no agreed CLV PASS tolerance** |
| Closing spread ATS | **FAIL vs coin** | n=754; engine spread Brier **0.311** > 0.25 — blocks restore of graded spreads |
| Totals | **ENGINE_VS_FINAL_ONLY** | MAE ≈ 12.96; over@projMean well-calibrated; **closing totals absent** → CLV INSUFFICIENT_DATA |
| ALT spreads | **MEASURED** | Fixed away ALTs + close±3.5 calibrated vs finals; **no posted ALT price archive** |
| E4 injury | **INSUFFICIENT_DATA** | Closing archive `injuryKnown`/`qbOut` all null (842/842) |
| E5 regressions | **PASS** | P0 + Phase E gates + college mix (after unit-mismatch test correction) |
| E6 human sign-off | **OPEN** | Named approver + date + SHA required |
| Isolated Coach E2E | **PASS (research unlock)** | 3/3 NCAAF ticket via env unlock only; product constant false |

## Withdrawn unit-mismatch claim (corrected)

The 2026-10-14 E2a **PASS** remains **WITHDRAWN** (`priorE2aClaim.restored: false`). That run fed PPG as PPD then ×0.48 college scale. Soft-rate unit tests that asserted monotonicity at ppd 12/15/20 inherited that mismatch; they are corrected to true PPD (2.5/3.5/4.5) without lowering +3 ppg / QB-out thresholds.

## Market-family sample sizes (2024 holdout, seed 20241015, 10k sims)

| Market | n | Key metric | vs coin / notes |
|--------|---|------------|-----------------|
| Moneyline | 865 | Brier 0.1987 | PASS |
| Close home spread | 754 | Brier **0.311** | **FAIL** (coin 0.25) |
| Away ALT +3.5…+21 | 865 each | Brier ~0.20–0.21 | Measured; no CLV |
| Totals (engine vs final) | 865 | MAE 12.96; over@proj Brier 0.248 | No close total |

## What remains before any flag flip

1. **Agreed E2b CLV acceptance rule** + human-reviewed PASS (current Coach pick CLV has no PASS label).  
2. **Closing-spread calibration fix** so ATS Brier beats coin (without lowering thresholds) — then re-run market families.  
3. **Pre-kickoff injury archive** (`injuryKnown` true|null, optional `qbOut`) for E4.  
4. **Closing totals / posted ALT prices** if those markets are in restore scope.  
5. **E6** named human sign-off on a flag-only PR.  
6. Keep **totals FG/team/period** on separate P0 even if sides clear.

## Isolated research unlock (not a product flip)

`NCAAF_ISOLATED_COACH_UNLOCK=1` + `NCAAF_ISOLATED_COACH_UNLOCK_ACK=research-only-not-product` enables sim→selection→delivery in offline harnesses only. Default product path stays P0-blocked.

## Fixtures / reports

- `artifacts/api-server/test/fixtures/ncaaf-phase-e-calibration-report.json`
- `artifacts/api-server/test/fixtures/ncaaf-phase-e-market-families-report.json`
- `artifacts/api-server/test/fixtures/ncaaf-phase-e-coach-pick-clv-report.json`
- `artifacts/api-server/test/fixtures/ncaaf-phase-e-selection-prices.json`
- `/opt/cursor/artifacts/ncaaf-isolated-coach-delivery.json`
