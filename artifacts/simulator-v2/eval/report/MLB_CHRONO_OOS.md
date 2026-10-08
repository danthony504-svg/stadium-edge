# MLB chronological OOS + family calibration gates

Shadow-only. `SIM_V2_SERVE=off`. Final holdout not used for tuning.
Root cause (ML ECE ≈0.229 on F.2): underdispersed independent Poisson innings + insufficient form shrinkage → overconfident ML probs.
Correction (`baseball.joint.v0` **0.3.0**): shrink form 40% toward `MLB_TEAM_FG_MEAN`, per-draw lognormal game shock (σ≈0.18), milder home edge (0.05).

- Games fetched: 3939 (2023=1980, 2024=1959); train 2166 / val 788 / holdout 985 (55/20/25)
- Holdout graded: 560 games → obs=5040; games_clustered=560; val diagnostic obs=900
- Mean runtime/game: 35.1 ms
- Val ECE (diagnostic only): 0.0406 | Holdout ECE: 0.0544 | ML holdout ECE: 0.1095
- Closing-line benchmark: **INSUFFICIENT_DATA** (no licensed historical odds source)
- Named player props: attempted ESPN summary boxscore athlete IDs (hits/HR/K); n=2880 from 120/120 games

### Family gates (final holdout)
| Family | Verdict | n | games | effN | Brier | LogLoss | ECE | ECE_SE | bias | reasons |
|--------|---------|---|-------|------|-------|---------|-----|--------|------|---------|
| mlb:ml | **FAIL** | 560 | 560 | 560.0 | 0.2570 | 0.7075 | 0.1095 | 0.0198 | -0.110 | ece_0.1095_gt_0.04 |
| mlb:spread | **FAIL** | 1120 | 560 | 560.0 | 0.2165 | 0.6256 | 0.0567 | 0.0191 | -0.057 | ece_0.0567_gt_0.04 |
| mlb:total | **FAIL** | 1120 | 560 | 560.0 | 0.2415 | 0.6772 | 0.0495 | 0.0099 | -0.014 | ece_0.0495_gt_0.04 |
| mlb:team_total | **FAIL** | 560 | 560 | 560.0 | 0.2532 | 0.6997 | 0.0665 | 0.0178 | 0.003 | ece_0.0665_gt_0.04 |
| mlb:f5 | **FAIL** | 1680 | 560 | 560.0 | 0.2501 | 0.6938 | 0.0411 | 0.0100 | -0.014 | ece_0.0411_gt_0.04 |
| mlb:main_all | **FAIL** | 3360 | 560 | 560.0 | 0.2495 | 0.6922 | 0.0590 | 0.0121 | -0.027 | ece_0.0590_gt_0.04 |
| mlb:alt_all | **FAIL** | 1680 | 560 | 560.0 | 0.2266 | 0.6469 | 0.0606 | 0.0116 | -0.043 | ece_0.0606_gt_0.04 |
| mlb:closing_line_benchmark | **INSUFFICIENT_DATA** | 0 | 0 | 0.0 | n/a | n/a | n/a | n/a | 0.000 | closing_line_unavailable_unlicensed |
| mlb:player_prop_named | **FAIL** | 2880 | 120 | 120.0 | 0.2095 | 0.6235 | 0.0919 | 0.0074 | 0.011 | ece_0.0919_gt_0.04 |

### Reliability (holdout ML)
| bin | n | avgPred | avgY | gap |
|-----|---|---------|------|-----|
| 0.2-0.3 | 7 | 0.294 | 0.429 | -0.134 |
| 0.3-0.4 | 152 | 0.356 | 0.467 | -0.111 |
| 0.4-0.5 | 288 | 0.448 | 0.587 | -0.139 |
| 0.5-0.6 | 111 | 0.533 | 0.559 | -0.025 |
| 0.6-0.7 | 2 | 0.605 | 1.000 | -0.395 |

### Reliability (holdout overall)
| bin | n | avgPred | avgY | gap |
|-----|---|---------|------|-----|
| 0.1-0.2 | 258 | 0.168 | 0.275 | -0.107 |
| 0.2-0.3 | 810 | 0.254 | 0.306 | -0.052 |
| 0.3-0.4 | 1369 | 0.352 | 0.416 | -0.064 |
| 0.4-0.5 | 1456 | 0.447 | 0.489 | -0.042 |
| 0.5-0.6 | 947 | 0.545 | 0.501 | 0.044 |
| 0.6-0.7 | 196 | 0.625 | 0.556 | 0.069 |
| 0.7-0.8 | 4 | 0.703 | 0.500 | 0.203 |

### Scoring distribution check (actual vs sim mean)
| Dist | n | actMean | simMean | err | actVar | simVar | varRatio | actP90 | simP90 |
|------|---|---------|---------|-----|--------|--------|----------|--------|--------|
| mlb_total | 560 | 9.03 | 8.99 | -0.04 | 18.64 | 0.30 | 0.02 | 14.0 | 9.7 |
| mlb_margin | 560 | 0.06 | 0.01 | -0.05 | 19.23 | 0.32 | 0.02 | 5.0 | 0.7 |

- Grid lines (−110). Production allowlists unchanged.
