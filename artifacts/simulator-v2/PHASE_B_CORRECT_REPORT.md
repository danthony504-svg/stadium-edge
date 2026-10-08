# Simulator V2 Phase B Correct — Model Correction Report

**Branch:** `cursor/simulator-v2-phase-b-correct-def8`  
**Base:** Phase B audit (`cursor/simulator-v2-phase-b-def8`)  
**Status:** Shadow-only. Production gates **closed**. No merge / OTA / Coach / P0 / PR #649.

## What changed (generative model)

| Lever | Implementation |
|-------|----------------|
| Home / margin bias | Train-frozen HFA (NFL +2.55, NCAAF +2.87 from residual on train fold) |
| Under-dispersion | Shared game + team + quarter gamma–Poisson mixture |
| Thin tails | Sum-normalized log-margin shock + small blowout mixture |
| Conservation | Unchanged: Q1+Q2+Q3+Q4 = H1+H2 = FG every draw |
| Sport separation | Independent `FROZEN_TRAIN_PARAMS` per sport |
| Holdout hygiene | Params frozen from train only; val/holdout report-only |

**Model ids:** `football.joint.phase_b_correct` @ `0.3.0` (default); `football.joint.phase_b` @ `0.2.0` retained for A/B.

## Chronological splits

| Sport | Train | Val | Holdout |
|-------|-------|-----|---------|
| NFL | 2022 (n=220) | 2023 (n=285) | **2024 (n=285)** |
| NCAAF | 2023 (n=531) | 2024 w1–7 (n=343) | **2024 w8–15 (n=404)** |

## Holdout results (corrected vs original)

### Scoring

| Sport | Model | Bias total | Bias margin | Var ratio | Tail cov@P90 |
|-------|-------|------------|-------------|-----------|--------------|
| NFL | correct | +1.80 | **+0.33** | **1.53** | 0.23 |
| NFL | v0 | +0.21 | −2.27 | 0.62 | 0.14 |
| NCAAF | correct | +2.73 | **−1.65** | **1.13** | 0.19 |
| NCAAF | v0 | +1.28 | −4.51 | 0.59 | 0.12 |

### FG family ECE (holdout)

| Sport | Family | correct ECE | v0 ECE | V1 ECE | hist ECE |
|-------|--------|-------------|--------|--------|----------|
| NFL | ml | **0.040** | 0.108 | 0.063 | 0.042 |
| NFL | spread | **0.024** | 0.098 | 0.055 | 0.047 |
| NFL | total | **0.029** | 0.077 | 0.068 | 0.032 |
| NFL | team_total | **0.019** | 0.085 | 0.070 | 0.032 |
| NCAAF | ml | **0.042** | 0.114 | 0.089 | 0.041 |
| NCAAF | spread | **0.031** | 0.123 | 0.074 | 0.026 |
| NCAAF | total | **0.041** | 0.068 | 0.042 | 0.023 |
| NCAAF | team_total | **0.023** | 0.080 | 0.056 | 0.028 |

Joint conservation: **100%** on all folds for correct and v0. Deterministic seeds preserved.

## Remaining failures

1. Production flags / shadow soak — gates stay closed by policy.
2. NFL ML holdout n=285 < 500 sample gate.
3. NCAAF ML ECE 0.0415 and total ECE 0.0411 (just over 0.04).
4. Period H1/Q2 ECE still weak (NFL Q2 holdout ECE ~0.13).
5. Mild positive total bias; NCAAF margin still slightly negative.
6. No closing-line market baseline (ESPN historical odds empty).

## Files changed

- `src/models/football/jointFootball.ts` — correct + v0 generators
- `src/models/football/trainFrozenParams.ts` — train-frozen knobs
- `src/validation/unsupported.ts` — allow both model ids
- `eval/chronoSplits.ts`, `eval/runChronologicalOos.ts`, `eval/engines.ts`
- `eval/report/CHRONOLOGICAL_OOS.md`, `chronological_oos_summary.json`
- `test/footballJoint.test.ts`, shadow health/models, package 0.3.0

## Tests

`pnpm --filter @workspace/simulator-v2 test` → **32/32 pass**  
`pnpm typecheck` → pass  
`pnpm eval:chrono-oos` → holdout report above
