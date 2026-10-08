# Basketball chronological OOS + family calibration gates

Shadow-only. SIM_V2_SERVE=off. Final holdout not used for tuning.
Root cause: form overconfidence + underdispersed margins → mild shrink (0.2) + lognormal shock + reduced HFA.

## NBA (separate gates)
- Model: basketball.joint.v0 @ 0.3.0 (mild shrink 0.2 + game shock; milder HFA)
- Games fetched: 1280 (train 704 / val 256 / holdout 320)
- Holdout graded: 320 games → obs=1920; val diagnostic obs=600
- Mean runtime/game: 6.6 ms
- Val ECE (diagnostic only): 0.1515 | Holdout ECE: 0.0957
- Closing-line benchmark: **INSUFFICIENT_DATA** (no licensed historical odds source wired)
- Named player props: not in this team-market pass

### Family gates (final holdout)
| Family | Verdict | n | games | effN | Brier | LogLoss | ECE | ECE_SE | bias | reasons |
|--------|---------|---|-------|------|-------|---------|-----|--------|------|---------|
| nba:ml | **INSUFFICIENT_DATA** | 320 | 320 | 320.0 | 0.2289 | 0.6503 | 0.1038 | 0.0240 | -0.023 | oos_sample_320_lt_500; ece_0.1038_gt_0.04 |
| nba:spread | **FAIL** | 640 | 320 | 320.0 | 0.2649 | 0.7240 | 0.2598 | 0.0240 | -0.260 | ece_0.2598_gt_0.04 |
| nba:total | **PASS** | 640 | 320 | 320.0 | 0.2350 | 0.6624 | 0.0318 | 0.0144 | -0.009 | — |
| nba:team_total | **INSUFFICIENT_DATA** | 320 | 320 | 320.0 | 0.2321 | 0.6565 | 0.0329 | 0.0200 | -0.013 | oos_sample_320_lt_500 |
| nba:main_all | **FAIL** | 1280 | 320 | 320.0 | 0.2343 | 0.6612 | 0.0613 | 0.0166 | -0.059 | ece_0.0613_gt_0.04 |
| nba:alt_all | **FAIL** | 640 | 320 | 320.0 | 0.2619 | 0.7175 | 0.1717 | 0.0180 | -0.169 | ece_0.1717_gt_0.04 |
| nba:closing_line_benchmark | **INSUFFICIENT_DATA** | 0 | 0 | 0.0 | n/a | n/a | n/a | n/a | 0.000 | closing_line_unavailable_unlicensed |
| nba:player_prop_named | **INSUFFICIENT_DATA** | 0 | 0 | 0.0 | n/a | n/a | n/a | n/a | 0.000 | named_player_prop_oos_not_wired_this_pass |

### Reliability (holdout overall)
| bin | n | avgPred | avgY | gap |
|-----|---|---------|------|-----|
| 0.2-0.3 | 32 | 0.274 | 0.281 | -0.008 |
| 0.3-0.4 | 289 | 0.362 | 0.464 | -0.102 |
| 0.4-0.5 | 683 | 0.453 | 0.553 | -0.101 |
| 0.5-0.6 | 659 | 0.544 | 0.648 | -0.104 |
| 0.6-0.7 | 242 | 0.633 | 0.702 | -0.069 |
| 0.7-0.8 | 15 | 0.717 | 0.733 | -0.016 |

### Scoring distribution check
| Dist | n | actMean | simMean | err | actVar | simVar | varRatio | actP90 | simP90 |
|------|---|---------|---------|-----|--------|--------|----------|--------|--------|
| nba_total | 320 | 228.32 | 229.26 | 0.94 | 422.24 | 25.45 | 0.06 | 255.0 | 235.4 |
| nba_margin | 320 | 2.71 | 1.97 | -0.74 | 265.40 | 17.89 | 0.07 | 22.0 | 7.7 |

## WNBA (separate gates)
- Model: basketball.joint.v0 @ 0.3.0 (mild shrink 0.2 + game shock; milder HFA)
- Games fetched: 709 (train 389 / val 142 / holdout 178)
- Holdout graded: 178 games → obs=1062; val diagnostic obs=594
- Mean runtime/game: 6.1 ms
- Val ECE (diagnostic only): 0.0989 | Holdout ECE: 0.0738
- Closing-line benchmark: **INSUFFICIENT_DATA** (no licensed historical odds source wired)
- Named player props: not in this team-market pass

### Family gates (final holdout)
| Family | Verdict | n | games | effN | Brier | LogLoss | ECE | ECE_SE | bias | reasons |
|--------|---------|---|-------|------|-------|---------|-----|--------|------|---------|
| wnba:ml | **INSUFFICIENT_DATA** | 177 | 177 | 177.0 | 0.2253 | 0.6429 | 0.0984 | 0.0287 | -0.017 | oos_sample_177_lt_500; ece_0.0984_gt_0.04 |
| wnba:spread | **INSUFFICIENT_DATA** | 354 | 177 | 177.0 | 0.2713 | 0.7379 | 0.2445 | 0.0294 | -0.244 | oos_sample_354_lt_500; ece_0.2445_gt_0.04 |
| wnba:total | **INSUFFICIENT_DATA** | 354 | 177 | 177.0 | 0.2179 | 0.6267 | 0.0643 | 0.0204 | 0.044 | oos_sample_354_lt_500; ece_0.0643_gt_0.04 |
| wnba:team_total | **INSUFFICIENT_DATA** | 177 | 177 | 177.0 | 0.2363 | 0.6651 | 0.0351 | 0.0248 | -0.025 | oos_sample_177_lt_500 |
| wnba:main_all | **FAIL** | 708 | 177 | 177.0 | 0.2323 | 0.6571 | 0.0683 | 0.0177 | -0.036 | ece_0.0683_gt_0.04 |
| wnba:alt_all | **INSUFFICIENT_DATA** | 354 | 177 | 177.0 | 0.2554 | 0.7045 | 0.1499 | 0.0221 | -0.150 | oos_sample_354_lt_500; ece_0.1499_gt_0.04 |
| wnba:closing_line_benchmark | **INSUFFICIENT_DATA** | 0 | 0 | 0.0 | n/a | n/a | n/a | n/a | 0.000 | closing_line_unavailable_unlicensed |
| wnba:player_prop_named | **INSUFFICIENT_DATA** | 0 | 0 | 0.0 | n/a | n/a | n/a | n/a | 0.000 | named_player_prop_oos_not_wired_this_pass |

### Reliability (holdout overall)
| bin | n | avgPred | avgY | gap |
|-----|---|---------|------|-----|
| 0.2-0.3 | 41 | 0.274 | 0.341 | -0.067 |
| 0.3-0.4 | 221 | 0.356 | 0.448 | -0.092 |
| 0.4-0.5 | 320 | 0.451 | 0.500 | -0.049 |
| 0.5-0.6 | 340 | 0.539 | 0.612 | -0.072 |
| 0.6-0.7 | 132 | 0.636 | 0.742 | -0.107 |
| 0.7-0.8 | 8 | 0.737 | 0.875 | -0.138 |

### Scoring distribution check
| Dist | n | actMean | simMean | err | actVar | simVar | varRatio | actP90 | simP90 |
|------|---|---------|---------|-----|--------|--------|----------|--------|--------|
| wnba_total | 177 | 164.46 | 165.59 | 1.13 | 308.91 | 14.28 | 0.05 | 187.0 | 170.7 |
| wnba_margin | 177 | 1.40 | 1.97 | 0.58 | 157.12 | 13.12 | 0.08 | 16.0 | 7.4 |

## NCAAB (separate gates)
- Model: basketball.joint.v0 @ 0.3.0 (mild shrink 0.2 + game shock; milder HFA)
- Games fetched: 7393 (train 4066 / val 1478 / holdout 1849)
- Holdout graded: 400 games → obs=2376; val diagnostic obs=540
- Mean runtime/game: 6.0 ms
- Val ECE (diagnostic only): 0.1343 | Holdout ECE: 0.1025
- Closing-line benchmark: **INSUFFICIENT_DATA** (no licensed historical odds source wired)
- Named player props: not in this team-market pass

### Family gates (final holdout)
| Family | Verdict | n | games | effN | Brier | LogLoss | ECE | ECE_SE | bias | reasons |
|--------|---------|---|-------|------|-------|---------|-----|--------|------|---------|
| ncaab:ml | **INSUFFICIENT_DATA** | 396 | 396 | 396.0 | 0.2220 | 0.6353 | 0.0805 | 0.0186 | -0.065 | oos_sample_396_lt_500; ece_0.0805_gt_0.04 |
| ncaab:spread | **FAIL** | 792 | 396 | 396.0 | 0.2729 | 0.7406 | 0.3020 | 0.0207 | -0.302 | ece_0.3020_gt_0.04 |
| ncaab:total | **FAIL** | 792 | 396 | 396.0 | 0.2174 | 0.6244 | 0.0615 | 0.0147 | 0.040 | ece_0.0615_gt_0.04 |
| ncaab:team_total | **INSUFFICIENT_DATA** | 396 | 396 | 396.0 | 0.2179 | 0.6265 | 0.0902 | 0.0197 | -0.019 | oos_sample_396_lt_500; ece_0.0902_gt_0.04 |
| ncaab:main_all | **FAIL** | 1584 | 396 | 396.0 | 0.2256 | 0.6425 | 0.0752 | 0.0153 | -0.068 | ece_0.0752_gt_0.04 |
| ncaab:alt_all | **FAIL** | 792 | 396 | 396.0 | 0.2591 | 0.7110 | 0.1770 | 0.0138 | -0.169 | ece_0.1770_gt_0.04 |
| ncaab:closing_line_benchmark | **INSUFFICIENT_DATA** | 0 | 0 | 0.0 | n/a | n/a | n/a | n/a | 0.000 | closing_line_unavailable_unlicensed |
| ncaab:player_prop_named | **INSUFFICIENT_DATA** | 0 | 0 | 0.0 | n/a | n/a | n/a | n/a | 0.000 | named_player_prop_oos_not_wired_this_pass |

### Reliability (holdout overall)
| bin | n | avgPred | avgY | gap |
|-----|---|---------|------|-----|
| 0.1-0.2 | 8 | 0.167 | 0.000 | 0.167 |
| 0.2-0.3 | 95 | 0.266 | 0.284 | -0.018 |
| 0.3-0.4 | 416 | 0.357 | 0.495 | -0.138 |
| 0.4-0.5 | 735 | 0.452 | 0.541 | -0.090 |
| 0.5-0.6 | 723 | 0.548 | 0.625 | -0.077 |
| 0.6-0.7 | 343 | 0.640 | 0.787 | -0.147 |
| 0.7-0.8 | 51 | 0.728 | 0.922 | -0.193 |
| 0.8-0.9 | 4 | 0.873 | 1.000 | -0.127 |
| 0.9-1.0 | 1 | 0.920 | 1.000 | -0.080 |

### Scoring distribution check
| Dist | n | actMean | simMean | err | actVar | simVar | varRatio | actP90 | simP90 |
|------|---|---------|---------|-----|--------|--------|----------|--------|--------|
| ncaab_total | 396 | 146.93 | 148.34 | 1.41 | 319.05 | 22.41 | 0.07 | 169.0 | 153.9 |
| ncaab_margin | 396 | 2.77 | 2.58 | -0.19 | 172.49 | 17.49 | 0.10 | 18.0 | 7.8 |

## Aggregate verdicts
| Family | Verdict | n | games | effN | Brier | LogLoss | ECE | ECE_SE | bias | reasons |
|--------|---------|---|-------|------|-------|---------|-----|--------|------|---------|
| nba:ml | **INSUFFICIENT_DATA** | 320 | 320 | 320.0 | 0.2289 | 0.6503 | 0.1038 | 0.0240 | -0.023 | oos_sample_320_lt_500; ece_0.1038_gt_0.04 |
| nba:spread | **FAIL** | 640 | 320 | 320.0 | 0.2649 | 0.7240 | 0.2598 | 0.0240 | -0.260 | ece_0.2598_gt_0.04 |
| nba:total | **PASS** | 640 | 320 | 320.0 | 0.2350 | 0.6624 | 0.0318 | 0.0144 | -0.009 | — |
| nba:team_total | **INSUFFICIENT_DATA** | 320 | 320 | 320.0 | 0.2321 | 0.6565 | 0.0329 | 0.0200 | -0.013 | oos_sample_320_lt_500 |
| nba:main_all | **FAIL** | 1280 | 320 | 320.0 | 0.2343 | 0.6612 | 0.0613 | 0.0166 | -0.059 | ece_0.0613_gt_0.04 |
| nba:alt_all | **FAIL** | 640 | 320 | 320.0 | 0.2619 | 0.7175 | 0.1717 | 0.0180 | -0.169 | ece_0.1717_gt_0.04 |
| nba:closing_line_benchmark | **INSUFFICIENT_DATA** | 0 | 0 | 0.0 | n/a | n/a | n/a | n/a | 0.000 | closing_line_unavailable_unlicensed |
| nba:player_prop_named | **INSUFFICIENT_DATA** | 0 | 0 | 0.0 | n/a | n/a | n/a | n/a | 0.000 | named_player_prop_oos_not_wired_this_pass |
| wnba:ml | **INSUFFICIENT_DATA** | 177 | 177 | 177.0 | 0.2253 | 0.6429 | 0.0984 | 0.0287 | -0.017 | oos_sample_177_lt_500; ece_0.0984_gt_0.04 |
| wnba:spread | **INSUFFICIENT_DATA** | 354 | 177 | 177.0 | 0.2713 | 0.7379 | 0.2445 | 0.0294 | -0.244 | oos_sample_354_lt_500; ece_0.2445_gt_0.04 |
| wnba:total | **INSUFFICIENT_DATA** | 354 | 177 | 177.0 | 0.2179 | 0.6267 | 0.0643 | 0.0204 | 0.044 | oos_sample_354_lt_500; ece_0.0643_gt_0.04 |
| wnba:team_total | **INSUFFICIENT_DATA** | 177 | 177 | 177.0 | 0.2363 | 0.6651 | 0.0351 | 0.0248 | -0.025 | oos_sample_177_lt_500 |
| wnba:main_all | **FAIL** | 708 | 177 | 177.0 | 0.2323 | 0.6571 | 0.0683 | 0.0177 | -0.036 | ece_0.0683_gt_0.04 |
| wnba:alt_all | **INSUFFICIENT_DATA** | 354 | 177 | 177.0 | 0.2554 | 0.7045 | 0.1499 | 0.0221 | -0.150 | oos_sample_354_lt_500; ece_0.1499_gt_0.04 |
| wnba:closing_line_benchmark | **INSUFFICIENT_DATA** | 0 | 0 | 0.0 | n/a | n/a | n/a | n/a | 0.000 | closing_line_unavailable_unlicensed |
| wnba:player_prop_named | **INSUFFICIENT_DATA** | 0 | 0 | 0.0 | n/a | n/a | n/a | n/a | 0.000 | named_player_prop_oos_not_wired_this_pass |
| ncaab:ml | **INSUFFICIENT_DATA** | 396 | 396 | 396.0 | 0.2220 | 0.6353 | 0.0805 | 0.0186 | -0.065 | oos_sample_396_lt_500; ece_0.0805_gt_0.04 |
| ncaab:spread | **FAIL** | 792 | 396 | 396.0 | 0.2729 | 0.7406 | 0.3020 | 0.0207 | -0.302 | ece_0.3020_gt_0.04 |
| ncaab:total | **FAIL** | 792 | 396 | 396.0 | 0.2174 | 0.6244 | 0.0615 | 0.0147 | 0.040 | ece_0.0615_gt_0.04 |
| ncaab:team_total | **INSUFFICIENT_DATA** | 396 | 396 | 396.0 | 0.2179 | 0.6265 | 0.0902 | 0.0197 | -0.019 | oos_sample_396_lt_500; ece_0.0902_gt_0.04 |
| ncaab:main_all | **FAIL** | 1584 | 396 | 396.0 | 0.2256 | 0.6425 | 0.0752 | 0.0153 | -0.068 | ece_0.0752_gt_0.04 |
| ncaab:alt_all | **FAIL** | 792 | 396 | 396.0 | 0.2591 | 0.7110 | 0.1770 | 0.0138 | -0.169 | ece_0.1770_gt_0.04 |
| ncaab:closing_line_benchmark | **INSUFFICIENT_DATA** | 0 | 0 | 0.0 | n/a | n/a | n/a | n/a | 0.000 | closing_line_unavailable_unlicensed |
| ncaab:player_prop_named | **INSUFFICIENT_DATA** | 0 | 0 | 0.0 | n/a | n/a | n/a | n/a | 0.000 | named_player_prop_oos_not_wired_this_pass |

- Production allowlists unchanged.