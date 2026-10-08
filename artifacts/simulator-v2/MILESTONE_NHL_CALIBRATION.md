# Milestone — NHL calibration (D.2+)

## Root cause
Holdout ECE ≈ 0.10 on v0.2.0 came from **form overconfidence** (raw recent GF/GA treated as true means) plus **Poisson underdispersion** on regulation team goals (no game-level intensity shock). Mild HFA (0.15) also sharpened home ML probs.

## Corrections (hockey.joint.v0 @ 0.3.0)
| Lever | Before | After |
|-------|--------|-------|
| Form → league shrink | none | 45% toward `NHL_TEAM_FG_MEAN` (was 40%; val lever + holdout confirm) |
| Per-draw mean shock | none | lognormal σ≈0.15 on each team λ |
| HFA (goals) | 0.15 | 0.08 |

## Eval
- Chrono OOS: `pnpm --filter @workspace/simulator-v2 eval:nhl-oos` → `eval/report/NHL_CHRONO_OOS.md`
- Family gates: `eval/report/NHL_FAMILY_GATES.md`
- Shared helpers: `eval/familyCalibration.ts`

## Gate snapshot
| Family | Verdict | n | games | effN | Brier | LogLoss | ECE | ECE_SE | bias | reasons |
|--------|---------|---|-------|------|-------|---------|-----|--------|------|---------|
| nhl:ml | **PASS** | 632 | 316 | 316.0 | 0.2509 | 0.6955 | 0.0380 | 0.0173 | -0.027 | — |
| nhl:spread | **FAIL** | 632 | 316 | 316.0 | 0.2035 | 0.6006 | 0.0623 | 0.0212 | -0.053 | ece_0.0623_gt_0.04 |
| nhl:total | **PASS** | 948 | 316 | 316.0 | 0.2509 | 0.6956 | 0.0378 | 0.0157 | 0.022 | — |
| nhl:team_total | **FAIL** | 632 | 316 | 316.0 | 0.2463 | 0.6871 | 0.0411 | 0.0175 | 0.015 | ece_0.0411_gt_0.04 |
| nhl:main_all | **FAIL** | 2212 | 316 | 316.0 | 0.2481 | 0.6908 | 0.0524 | 0.0130 | -0.012 | ece_0.0524_gt_0.04 |
| nhl:alt_all | **FAIL** | 632 | 316 | 316.0 | 0.2086 | 0.6087 | 0.0559 | 0.0145 | 0.009 | ece_0.0559_gt_0.04 |
| nhl:closing_line_benchmark | **INSUFFICIENT_DATA** | 0 | 0 | 0.0 | n/a | n/a | n/a | n/a | 0.000 | closing_line_unavailable_unlicensed |
| nhl:player_prop_named | **FAIL** | 840 | 60 | 60.0 | 0.2840 | 0.7719 | 0.3932 | 0.0092 | 0.393 | ece_0.3932_gt_0.04 |

## Status
- Shadow-only; `SIM_V2_SERVE` off; allowlists empty.
- Closing lines: INSUFFICIENT (unlicensed).
- Do not enable production serve from this milestone.
