# NCAAF Phase E — acceptance checklist (do not flip P0)

**Holdout:** ESPN scoreboard 2023–2024 (`test/fixtures/ncaaf-phase-e-games.json`, 1739 games).  
**Engine under test:** coach `nfl-drive` (`ncaafPhaseEHoldoutCalibration.ts`).  
**Gate:** `NCAAF_GAME_LINE_SIM_VALIDATED` stays `false` until every restore criterion is PASS + human sign-off.

## Latest calibration report (2024 holdout)

Source: `artifacts/api-server/test/fixtures/ncaaf-phase-e-calibration-report.json`

| Metric | Value |
|--------|-------|
| Holdout games scored | 796 (75 skipped thin form) |
| Sims / game | 1500 |
| Brier (engine) | **0.210** |
| Brier (coin) | 0.250 |
| Log loss | 0.609 |
| ECE (10-bin) | 0.116 |
| meanP / meanY (home ML) | **0.495 / 0.608** (home-win underprediction) |
| Near-coin-flip ML + away +7.5 cover | 0.547 (n=179) — OK vs 0.70 cap |
| Closing-line CLV | **INSUFFICIENT_DATA** (no licensed close archive in env) |
| Injury segments | **INSUFFICIENT_DATA** |

## Criterion board

| # | Criterion | Status | Notes |
|---|-----------|--------|-------|
| E1 | Sensitivity ±3 ppg / QB-out ≥2pp | **PASS (unit)** | `ncaafGameLineSimValidation.test.ts` |
| E2a | Outcome calibration vs coin (Brier, ECE, dog pathology, bias) | **FAIL** | Beats coin + dog OK, but \|meanP−meanY\|≈0.113 > 0.08 bias cap |
| E2b | Closing-line / market CLV | **INSUFFICIENT_DATA** | Needs licensed closing spreads/ML |
| E3 | Exact-line binder | **PASS (unit)** | `gameSimQualityGates.test.ts` |
| E4 | Injury conservatism | **INSUFFICIENT_DATA** | Scoreboard cache has no QB/injury flags |
| E5 | Props / other-sport P0 regressions | **PASS (unit suite)** | Re-run before any flag flip |
| E6 | Human sign-off | **OPEN** | Required after E2a/E2b/E4 PASS |

**Restore readiness:** **NO** — college game lines stay P0-blocked.

## Sign-off criteria before flipping `NCAAF_GAME_LINE_SIM_VALIDATED`

All of the following must be true in a single PR that only flips the flag:

1. **E2a PASS** — holdout report shows Brier < coin, ECE ≤ 0.12, \|meanP−meanY\| ≤ 0.08, near-coin +7.5 dog cover ≤ 0.70 (n≥30).
2. **E2b PASS** — frozen closing-line archive wired; engine CLV / market-Brier within agreed tolerance vs close (document numbers in the PR).
3. **E4 PASS** — injury-known vs unknown segments: unknown must not show higher mean \|edge\| than known.
4. **E5 green** — `coachP0UnvalidatedTotals`, college mix proof, NFL/NHL totals P0 tests pass on that commit.
5. **E6** — named human approver + date + commit SHA recorded in the PR body.
6. Totals (FG/team/period) remain on their separate P0 until totals recalibration — this flag only clears **game-side** NCAAF lines.

## Commands

```bash
# Rebuild holdout report (keeps flag false; exits 2 while restore blocked)
cd artifacts/api-server
NCAAF_PHASE_E_SIMS=1500 node --import ./test/register-hooks.mjs \
  ./scripts/ncaafPhaseEHoldoutCalibration.ts

# Unit gates
node --import ./test/register-hooks.mjs --test \
  test/ncaafGameLineSimValidation.test.ts \
  test/ncaafPhaseEGates.test.ts
```
