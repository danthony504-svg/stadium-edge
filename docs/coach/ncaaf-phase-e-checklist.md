# NCAAF Phase E — acceptance checklist (do not flip P0)

**Commit under preview test:** `0d10cce7fab76d0c36180f11b80fb282a1078117`  
**Gate:** `NCAAF_GAME_LINE_SIM_VALIDATED` must stay `false` until every row is PASS + human sign-off.  
**This document prepares checks only — it does not restore college game-line grades.**

| # | Criterion | Status | Evidence / remaining work |
|---|-----------|--------|---------------------------|
| E1 | Sensitivity: ±3 ppg and QB-out proxy move cover ≥2pp | **PASS (unit)** | `artifacts/api-server/test/ncaafGameLineSimValidation.test.ts` — `+3 ppg` / `QB-out` cases |
| E2 | Calibration: decile error ≤ market baseline + tolerance; no systematic 70%+ dog covers on +7.5 with ~50% ML | **OPEN** | Needs Phase D frozen out-of-sample backtest (closing lines + outcomes). Harness stub: `scripts/ncaafPhaseECalibrationStub.ts` — fill with slate CSV before claiming PASS |
| E3 | Exact-line: graded spreads bind `point` + book price from same row; unposted lines stay ungraded | **PASS (unit)** | `artifacts/stadium-mobile/lib/gameSimQualityGates.test.ts` — exact-line pricing / binder cases |
| E4 | Injury conservatism: missing QB/injury data must not show higher avg \|edge\| than injury-known | **OPEN** | Requires injury-segmented backtest over E2 universe. Stub metrics in calibration stub; do not invent edges |
| E5 | Props / other sports regressions unchanged | **PASS (unit suite)** | Keep running: `coachP0UnvalidatedTotals.test.ts`, `coachCollegeMarketMix.proof.test.ts`, NFL/NHL totals P0 tests. Re-run before any flag flip |
| E6 | Explicit human sign-off | **OPEN** | No silent restore. Approver records date + commit SHA in PR before setting `NCAAF_GAME_LINE_SIM_VALIDATED = true` |

## How to run prepared checks (no flag flip)

```bash
# E1 + seal (flag still false)
cd artifacts/api-server
node --import ./test/register-hooks.mjs --test test/ncaafGameLineSimValidation.test.ts test/nflDriveSimCaps.test.ts

# E3 + E5 client gates
cd artifacts/stadium-mobile
node --import ./test/register-hooks.mjs --test \
  lib/gameSimQualityGates.test.ts \
  lib/coachP0UnvalidatedTotals.test.ts \
  lib/coachCollegeMarketMix.proof.test.ts

# E2/E4 stub (exits non-zero until real fixture provided)
cd artifacts/api-server
node --import ./test/register-hooks.mjs ../stadium-mobile/../api-server/scripts/ncaafPhaseECalibrationStub.ts
# or: npx tsx scripts/ncaafPhaseECalibrationStub.ts
```

## Restore rule

Only after E1–E5 are PASS on a frozen window **and** E6 human approval:

1. Set `NCAAF_GAME_LINE_SIM_VALIDATED = true` in a dedicated PR.
2. Keep FG/team/period totals P0 until separate totals recalibration.
3. Staging / shadow week before production (Phase F).
