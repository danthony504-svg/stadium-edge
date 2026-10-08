# NHL chronological OOS + family calibration gates

Shadow-only. `SIM_V2_SERVE=off`. Final holdout not used for tuning.
Root cause (ECE≈0.10): form overconfidence + Poisson underdispersion on regulation goals → shrink form 40% to league mean + per-draw lognormal σ≈0.15 + milder HFA (0.08).

## Holdout summary
- Model: hockey.joint.v0 @ 0.3.0
- Fetch: ESPN date-sample + week fill (2023 n=1998, 2024 n=2032)
- Splits: train=2023 (1998), val=early-2024 diagnostic (1117), holdout pool mid+late-2024 (915)
- Holdout graded: 316 games → obs=2844; clusters=316; val diagnostic obs=720
- Mean runtime/game: 28.6 ms
- Val ECE (diagnostic only): 0.0361 | Holdout ECE: 0.0393
- Closing-line benchmark: **INSUFFICIENT_DATA** (unlicensed / no archive)
- Named player props: boxscore athlete IDs on 60 holdout games → prop obs=840

### Family gates (final holdout)
| Family | Verdict | n | games | effN | Brier | LogLoss | ECE | ECE_SE | bias | reasons |
|--------|---------|---|-------|------|-------|---------|-----|--------|------|---------|
| nhl:ml | **PASS** | 632 | 316 | 316.0 | 0.2509 | 0.6955 | 0.0380 | 0.0173 | -0.027 | — |
| nhl:spread | **FAIL** | 632 | 316 | 316.0 | 0.2035 | 0.6006 | 0.0623 | 0.0212 | -0.053 | ece_0.0623_gt_0.04 |
| nhl:total | **PASS** | 948 | 316 | 316.0 | 0.2509 | 0.6956 | 0.0378 | 0.0157 | 0.022 | — |
| nhl:team_total | **FAIL** | 632 | 316 | 316.0 | 0.2463 | 0.6871 | 0.0411 | 0.0175 | 0.015 | ece_0.0411_gt_0.04 |
| nhl:main_all | **FAIL** | 2212 | 316 | 316.0 | 0.2481 | 0.6908 | 0.0524 | 0.0130 | -0.012 | ece_0.0524_gt_0.04 |
| nhl:alt_all | **FAIL** | 632 | 316 | 316.0 | 0.2086 | 0.6087 | 0.0559 | 0.0145 | 0.009 | ece_0.0559_gt_0.04 |
| nhl:slice:ml_home_final | **INSUFFICIENT_DATA** | 316 | 316 | 316.0 | 0.2494 | 0.6922 | 0.0466 | 0.0228 | -0.039 | oos_sample_316_lt_500; ece_0.0466_gt_0.04 |
| nhl:slice:ml_home_regulation | **INSUFFICIENT_DATA** | 316 | 316 | 316.0 | 0.2523 | 0.6988 | 0.0421 | 0.0215 | -0.015 | oos_sample_316_lt_500; ece_0.0421_gt_0.04 |
| nhl:slice:total_final_5.5 | **INSUFFICIENT_DATA** | 316 | 316 | 316.0 | 0.2521 | 0.6984 | 0.0702 | 0.0251 | 0.008 | oos_sample_316_lt_500; ece_0.0702_gt_0.04 |
| nhl:slice:total_regulation_5.5 | **INSUFFICIENT_DATA** | 316 | 316 | 316.0 | 0.2521 | 0.6984 | 0.0702 | 0.0269 | 0.008 | oos_sample_316_lt_500; ece_0.0702_gt_0.04 |
| nhl:slice:tt_home_final_2.5 | **INSUFFICIENT_DATA** | 316 | 316 | 316.0 | 0.2429 | 0.6804 | 0.0520 | 0.0209 | 0.013 | oos_sample_316_lt_500; ece_0.0520_gt_0.04 |
| nhl:slice:tt_home_regulation_2.5 | **INSUFFICIENT_DATA** | 316 | 316 | 316.0 | 0.2497 | 0.6939 | 0.0302 | 0.0189 | 0.018 | oos_sample_316_lt_500 |
| nhl:closing_line_benchmark | **INSUFFICIENT_DATA** | 0 | 0 | 0.0 | n/a | n/a | n/a | n/a | 0.000 | closing_line_unavailable_unlicensed |
| nhl:player_prop_named | **FAIL** | 840 | 60 | 60.0 | 0.2840 | 0.7719 | 0.3932 | 0.0092 | 0.393 | ece_0.3932_gt_0.04 |

### Reliability (holdout overall)
| bin | n | avgPred | avgY | gap |
|-----|---|---------|------|-----|
| 0.0-0.1 | 21 | 0.083 | 0.238 | -0.155 |
| 0.1-0.2 | 230 | 0.156 | 0.217 | -0.062 |
| 0.2-0.3 | 252 | 0.245 | 0.306 | -0.061 |
| 0.3-0.4 | 299 | 0.353 | 0.398 | -0.045 |
| 0.4-0.5 | 547 | 0.457 | 0.486 | -0.030 |
| 0.5-0.6 | 840 | 0.552 | 0.556 | -0.004 |
| 0.6-0.7 | 598 | 0.639 | 0.587 | 0.052 |
| 0.7-0.8 | 57 | 0.728 | 0.474 | 0.255 |

### Scoring distribution check (goals / totals / margins)
| Dist | n | actMean | simMean | err | actVar | simVar | varRatio | actP90 | simP90 |
|------|---|---------|---------|-----|--------|--------|----------|--------|--------|
| nhl_reg_team_goals | 632 | 2.98 | 3.09 | 0.12 | 3.05 | 0.12 | 0.04 | 5.0 | 3.5 |
| nhl_final_total | 316 | 6.15 | 6.34 | 0.19 | 5.49 | 0.19 | 0.03 | 9.0 | 6.9 |
| nhl_final_margin | 316 | 0.26 | 0.11 | -0.15 | 6.70 | 0.26 | 0.04 | 3.0 | 0.7 |

- Production allowlists unchanged. Coach/P0/PR#649 untouched.
