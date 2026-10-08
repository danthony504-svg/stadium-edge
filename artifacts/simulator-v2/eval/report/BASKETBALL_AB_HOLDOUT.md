# Basketball A/B chronological holdout (v0.2 vs v0.3)

Shadow-only. Identical holdout games/markets/odds per league. Gates unchanged (minOos=500, maxEce=0.04).
shrink50=YES when ECE improves >0.01 and mean |p−0.5| drops >25% (suspect confidence collapse).

## NBA A/B (identical holdout)
- Holdout games graded: 320 (train/val unused for grading; chrono freeze)
- Draws/game: 2000; odds: eval-grid −110 (not closing lines)
- Within-draw total var: v0.2=231.16 → v0.3=612.29
- p95 runtime/game: v0.2=3.9 ms → v0.3=4.2 ms
- Game clusters (main_all v0.3): 320; effN=320.0

### Before / after
| Family | v0.2 ECE | v0.3 ECE | ΔECE | v0.2 Brier | v0.3 Brier | ΔBrier | v0.2 LL | v0.3 LL | mad½ 0.2→0.3 | shrink50? | n | v0.2 | v0.3 |
|--------|----------|----------|------|------------|------------|--------|---------|---------|--------------|-----------|---|------|------|
| nba:ml | 0.0482 | 0.0992 | 0.0510 | 0.2194 | 0.2301 | 0.0107 | 0.6295 | 0.6527 | 0.111→0.057 | no | 320 | **INSUFFICIENT_DATA** | **INSUFFICIENT_DATA** |
| nba:spread | 0.2811 | 0.2606 | -0.0205 | 0.2738 | 0.2655 | -0.0083 | 0.7484 | 0.7252 | 0.128→0.077 | YES | 640 | **FAIL** | **FAIL** |
| nba:total | 0.0645 | 0.0307 | -0.0338 | 0.2383 | 0.2355 | -0.0028 | 0.6726 | 0.6634 | 0.152→0.084 | YES | 640 | **FAIL** | **PASS** |
| nba:team_total | 0.0819 | 0.0446 | -0.0373 | 0.2344 | 0.2322 | -0.0022 | 0.6612 | 0.6568 | 0.160→0.073 | YES | 320 | **INSUFFICIENT_DATA** | **INSUFFICIENT_DATA** |
| nba:main_all | 0.0487 | 0.0612 | 0.0124 | 0.2322 | 0.2348 | 0.0026 | 0.6585 | 0.6623 | 0.137→0.068 | no | 1280 | **FAIL** | **FAIL** |
| nba:alt_all | 0.1895 | 0.1744 | -0.0151 | 0.2745 | 0.2624 | -0.0120 | 0.7494 | 0.7187 | 0.141→0.090 | YES | 640 | **FAIL** | **FAIL** |

### Gates (both profiles)
| Family | Verdict | n | games | effN | Brier | LogLoss | ECE | ECE_SE | bias | reasons |
|--------|---------|---|-------|------|-------|---------|-----|--------|------|---------|
| nba:ml:v0.2 | **INSUFFICIENT_DATA** | 320 | 320 | 320.0 | 0.2194 | 0.6295 | 0.0482 | 0.0192 | -0.001 | oos_sample_320_lt_500; ece_0.0482_gt_0.04 |
| nba:ml:v0.3 | **INSUFFICIENT_DATA** | 320 | 320 | 320.0 | 0.2301 | 0.6527 | 0.0992 | 0.0238 | -0.025 | oos_sample_320_lt_500; ece_0.0992_gt_0.04 |
| nba:spread:v0.2 | **FAIL** | 640 | 320 | 320.0 | 0.2738 | 0.7484 | 0.2811 | 0.0231 | -0.281 | ece_0.2811_gt_0.04 |
| nba:spread:v0.3 | **FAIL** | 640 | 320 | 320.0 | 0.2655 | 0.7252 | 0.2606 | 0.0223 | -0.261 | ece_0.2606_gt_0.04 |
| nba:total:v0.2 | **FAIL** | 640 | 320 | 320.0 | 0.2383 | 0.6726 | 0.0645 | 0.0188 | 0.036 | ece_0.0645_gt_0.04 |
| nba:total:v0.3 | **PASS** | 640 | 320 | 320.0 | 0.2355 | 0.6634 | 0.0307 | 0.0137 | -0.009 | — |
| nba:team_total:v0.2 | **INSUFFICIENT_DATA** | 320 | 320 | 320.0 | 0.2344 | 0.6612 | 0.0819 | 0.0227 | 0.064 | oos_sample_320_lt_500; ece_0.0819_gt_0.04 |
| nba:team_total:v0.3 | **INSUFFICIENT_DATA** | 320 | 320 | 320.0 | 0.2322 | 0.6568 | 0.0446 | 0.0200 | -0.014 | oos_sample_320_lt_500; ece_0.0446_gt_0.04 |
| nba:main_all:v0.2 | **FAIL** | 1280 | 320 | 320.0 | 0.2322 | 0.6585 | 0.0487 | 0.0127 | -0.016 | ece_0.0487_gt_0.04 |
| nba:main_all:v0.3 | **FAIL** | 1280 | 320 | 320.0 | 0.2348 | 0.6623 | 0.0612 | 0.0164 | -0.059 | ece_0.0612_gt_0.04 |
| nba:alt_all:v0.2 | **FAIL** | 640 | 320 | 320.0 | 0.2745 | 0.7494 | 0.1895 | 0.0178 | -0.182 | ece_0.1895_gt_0.04 |
| nba:alt_all:v0.3 | **FAIL** | 640 | 320 | 320.0 | 0.2624 | 0.7187 | 0.1744 | 0.0175 | -0.170 | ece_0.1744_gt_0.04 |
| nba:closing_line_benchmark | **INSUFFICIENT_DATA** | 0 | 0 | 0.0 | n/a | n/a | n/a | n/a | 0.000 | closing_line_unavailable_unlicensed |
| nba:player_prop_named | **INSUFFICIENT_DATA** | 0 | 0 | 0.0 | n/a | n/a | n/a | n/a | 0.000 | named_player_prop_oos_not_wired_this_pass |

### Scoring distribution
| Dist | n | actMean | simMean | err | actVar | simVar | varRatio | actP90 | simP90 |
|------|---|---------|---------|-----|--------|--------|----------|--------|--------|
| nba_total_v0.2 | 320 | 228.32 | 230.47 | 2.15 | 422.24 | 40.45 | 0.10 | 255.0 | 238.3 |
| nba_margin_v0.2 | 320 | 2.71 | 2.35 | -0.36 | 265.40 | 27.36 | 0.10 | 22.0 | 9.2 |
| nba_total_v0.3 | 320 | 228.32 | 229.26 | 0.95 | 422.24 | 25.56 | 0.06 | 255.0 | 235.5 |
| nba_margin_v0.3 | 320 | 2.71 | 1.94 | -0.77 | 265.40 | 17.93 | 0.07 | 22.0 | 7.5 |

## WNBA A/B (identical holdout)
- Holdout games graded: 178 (train/val unused for grading; chrono freeze)
- Draws/game: 2000; odds: eval-grid −110 (not closing lines)
- Within-draw total var: v0.2=165.47 → v0.3=364.07
- p95 runtime/game: v0.2=3.0 ms → v0.3=3.2 ms
- Game clusters (main_all v0.3): 177; effN=177.0

### Before / after
| Family | v0.2 ECE | v0.3 ECE | ΔECE | v0.2 Brier | v0.3 Brier | ΔBrier | v0.2 LL | v0.3 LL | mad½ 0.2→0.3 | shrink50? | n | v0.2 | v0.3 |
|--------|----------|----------|------|------------|------------|--------|---------|---------|--------------|-----------|---|------|------|
| wnba:ml | 0.1217 | 0.1153 | -0.0064 | 0.2155 | 0.2250 | 0.0095 | 0.6214 | 0.6423 | 0.118→0.066 | no | 177 | **INSUFFICIENT_DATA** | **INSUFFICIENT_DATA** |
| wnba:spread | 0.2578 | 0.2455 | -0.0123 | 0.2770 | 0.2709 | -0.0061 | 0.7579 | 0.7374 | 0.139→0.093 | YES | 354 | **INSUFFICIENT_DATA** | **INSUFFICIENT_DATA** |
| wnba:total | 0.0652 | 0.0696 | 0.0044 | 0.2124 | 0.2191 | 0.0067 | 0.6135 | 0.6293 | 0.146→0.095 | no | 354 | **INSUFFICIENT_DATA** | **INSUFFICIENT_DATA** |
| wnba:team_total | 0.0781 | 0.0311 | -0.0470 | 0.2359 | 0.2365 | 0.0006 | 0.6643 | 0.6655 | 0.132→0.067 | YES | 177 | **INSUFFICIENT_DATA** | **INSUFFICIENT_DATA** |
| wnba:main_all | 0.0567 | 0.0803 | 0.0236 | 0.2270 | 0.2323 | 0.0053 | 0.6458 | 0.6572 | 0.123→0.068 | no | 708 | **FAIL** | **FAIL** |
| wnba:alt_all | 0.1763 | 0.1501 | -0.0262 | 0.2611 | 0.2561 | -0.0050 | 0.7225 | 0.7063 | 0.163→0.118 | YES | 354 | **INSUFFICIENT_DATA** | **INSUFFICIENT_DATA** |

### Gates (both profiles)
| Family | Verdict | n | games | effN | Brier | LogLoss | ECE | ECE_SE | bias | reasons |
|--------|---------|---|-------|------|-------|---------|-----|--------|------|---------|
| wnba:ml:v0.2 | **INSUFFICIENT_DATA** | 177 | 177 | 177.0 | 0.2155 | 0.6214 | 0.1217 | 0.0274 | 0.010 | oos_sample_177_lt_500; ece_0.1217_gt_0.04 |
| wnba:ml:v0.3 | **INSUFFICIENT_DATA** | 177 | 177 | 177.0 | 0.2250 | 0.6423 | 0.1153 | 0.0301 | -0.018 | oos_sample_177_lt_500; ece_0.1153_gt_0.04 |
| wnba:spread:v0.2 | **INSUFFICIENT_DATA** | 354 | 177 | 177.0 | 0.2770 | 0.7579 | 0.2578 | 0.0293 | -0.258 | oos_sample_354_lt_500; ece_0.2578_gt_0.04 |
| wnba:spread:v0.3 | **INSUFFICIENT_DATA** | 354 | 177 | 177.0 | 0.2709 | 0.7374 | 0.2455 | 0.0305 | -0.246 | oos_sample_354_lt_500; ece_0.2455_gt_0.04 |
| wnba:total:v0.2 | **INSUFFICIENT_DATA** | 354 | 177 | 177.0 | 0.2124 | 0.6135 | 0.0652 | 0.0227 | 0.059 | oos_sample_354_lt_500; ece_0.0652_gt_0.04 |
| wnba:total:v0.3 | **INSUFFICIENT_DATA** | 354 | 177 | 177.0 | 0.2191 | 0.6293 | 0.0696 | 0.0221 | 0.044 | oos_sample_354_lt_500; ece_0.0696_gt_0.04 |
| wnba:team_total:v0.2 | **INSUFFICIENT_DATA** | 177 | 177 | 177.0 | 0.2359 | 0.6643 | 0.0781 | 0.0315 | 0.036 | oos_sample_177_lt_500; ece_0.0781_gt_0.04 |
| wnba:team_total:v0.3 | **INSUFFICIENT_DATA** | 177 | 177 | 177.0 | 0.2365 | 0.6655 | 0.0311 | 0.0245 | -0.025 | oos_sample_177_lt_500 |
| wnba:main_all:v0.2 | **FAIL** | 708 | 177 | 177.0 | 0.2270 | 0.6458 | 0.0567 | 0.0160 | -0.001 | ece_0.0567_gt_0.04 |
| wnba:main_all:v0.3 | **FAIL** | 708 | 177 | 177.0 | 0.2323 | 0.6572 | 0.0803 | 0.0177 | -0.036 | ece_0.0803_gt_0.04 |
| wnba:alt_all:v0.2 | **INSUFFICIENT_DATA** | 354 | 177 | 177.0 | 0.2611 | 0.7225 | 0.1763 | 0.0226 | -0.174 | oos_sample_354_lt_500; ece_0.1763_gt_0.04 |
| wnba:alt_all:v0.3 | **INSUFFICIENT_DATA** | 354 | 177 | 177.0 | 0.2561 | 0.7063 | 0.1501 | 0.0213 | -0.150 | oos_sample_354_lt_500; ece_0.1501_gt_0.04 |
| wnba:closing_line_benchmark | **INSUFFICIENT_DATA** | 0 | 0 | 0.0 | n/a | n/a | n/a | n/a | 0.000 | closing_line_unavailable_unlicensed |
| wnba:player_prop_named | **INSUFFICIENT_DATA** | 0 | 0 | 0.0 | n/a | n/a | n/a | n/a | 0.000 | named_player_prop_oos_not_wired_this_pass |

### Scoring distribution
| Dist | n | actMean | simMean | err | actVar | simVar | varRatio | actP90 | simP90 |
|------|---|---------|---------|-----|--------|--------|----------|--------|--------|
| wnba_total_v0.2 | 177 | 164.46 | 166.12 | 1.66 | 308.91 | 22.00 | 0.07 | 187.0 | 172.7 |
| wnba_margin_v0.2 | 177 | 1.40 | 2.54 | 1.14 | 157.12 | 20.20 | 0.13 | 16.0 | 9.3 |
| wnba_total_v0.3 | 177 | 164.46 | 165.61 | 1.15 | 308.91 | 14.27 | 0.05 | 187.0 | 170.8 |
| wnba_margin_v0.3 | 177 | 1.40 | 1.94 | 0.55 | 157.12 | 13.29 | 0.08 | 16.0 | 7.6 |

## NCAAB A/B (identical holdout)
- Holdout games graded: 400 (train/val unused for grading; chrono freeze)
- Draws/game: 2000; odds: eval-grid −110 (not closing lines)
- Within-draw total var: v0.2=149.46 → v0.3=366.47
- p95 runtime/game: v0.2=2.2 ms → v0.3=2.0 ms
- Game clusters (main_all v0.3): 396; effN=396.0

### Before / after
| Family | v0.2 ECE | v0.3 ECE | ΔECE | v0.2 Brier | v0.3 Brier | ΔBrier | v0.2 LL | v0.3 LL | mad½ 0.2→0.3 | shrink50? | n | v0.2 | v0.3 |
|--------|----------|----------|------|------------|------------|--------|---------|---------|--------------|-----------|---|------|------|
| ncaab:ml | 0.0663 | 0.0798 | 0.0135 | 0.2126 | 0.2224 | 0.0099 | 0.6111 | 0.6360 | 0.137→0.074 | no | 396 | **INSUFFICIENT_DATA** | **INSUFFICIENT_DATA** |
| ncaab:spread | 0.3108 | 0.3028 | -0.0081 | 0.2789 | 0.2730 | -0.0059 | 0.7590 | 0.7407 | 0.144→0.091 | no | 792 | **FAIL** | **FAIL** |
| ncaab:total | 0.0792 | 0.0587 | -0.0205 | 0.2171 | 0.2174 | 0.0004 | 0.6216 | 0.6247 | 0.170→0.103 | YES | 792 | **FAIL** | **FAIL** |
| ncaab:team_total | 0.0936 | 0.0939 | 0.0002 | 0.2118 | 0.2169 | 0.0051 | 0.6087 | 0.6244 | 0.179→0.087 | no | 396 | **INSUFFICIENT_DATA** | **INSUFFICIENT_DATA** |
| ncaab:main_all | 0.0396 | 0.0752 | 0.0356 | 0.2194 | 0.2254 | 0.0061 | 0.6266 | 0.6421 | 0.155→0.081 | no | 1584 | **PASS** | **FAIL** |
| ncaab:alt_all | 0.1873 | 0.1810 | -0.0064 | 0.2694 | 0.2592 | -0.0102 | 0.7373 | 0.7112 | 0.162→0.113 | no | 792 | **FAIL** | **FAIL** |

### Gates (both profiles)
| Family | Verdict | n | games | effN | Brier | LogLoss | ECE | ECE_SE | bias | reasons |
|--------|---------|---|-------|------|-------|---------|-----|--------|------|---------|
| ncaab:ml:v0.2 | **INSUFFICIENT_DATA** | 396 | 396 | 396.0 | 0.2126 | 0.6111 | 0.0663 | 0.0194 | -0.027 | oos_sample_396_lt_500; ece_0.0663_gt_0.04 |
| ncaab:ml:v0.3 | **INSUFFICIENT_DATA** | 396 | 396 | 396.0 | 0.2224 | 0.6360 | 0.0798 | 0.0196 | -0.064 | oos_sample_396_lt_500; ece_0.0798_gt_0.04 |
| ncaab:spread:v0.2 | **FAIL** | 792 | 396 | 396.0 | 0.2789 | 0.7590 | 0.3108 | 0.0193 | -0.311 | ece_0.3108_gt_0.04 |
| ncaab:spread:v0.3 | **FAIL** | 792 | 396 | 396.0 | 0.2730 | 0.7407 | 0.3028 | 0.0181 | -0.302 | ece_0.3028_gt_0.04 |
| ncaab:total:v0.2 | **FAIL** | 792 | 396 | 396.0 | 0.2171 | 0.6216 | 0.0792 | 0.0170 | 0.079 | ece_0.0792_gt_0.04 |
| ncaab:total:v0.3 | **FAIL** | 792 | 396 | 396.0 | 0.2174 | 0.6247 | 0.0587 | 0.0141 | 0.040 | ece_0.0587_gt_0.04 |
| ncaab:team_total:v0.2 | **INSUFFICIENT_DATA** | 396 | 396 | 396.0 | 0.2118 | 0.6087 | 0.0936 | 0.0203 | 0.068 | oos_sample_396_lt_500; ece_0.0936_gt_0.04 |
| ncaab:team_total:v0.3 | **INSUFFICIENT_DATA** | 396 | 396 | 396.0 | 0.2169 | 0.6244 | 0.0939 | 0.0165 | -0.018 | oos_sample_396_lt_500; ece_0.0939_gt_0.04 |
| ncaab:main_all:v0.2 | **PASS** | 1584 | 396 | 396.0 | 0.2194 | 0.6266 | 0.0396 | 0.0116 | -0.015 | — |
| ncaab:main_all:v0.3 | **FAIL** | 1584 | 396 | 396.0 | 0.2254 | 0.6421 | 0.0752 | 0.0148 | -0.067 | ece_0.0752_gt_0.04 |
| ncaab:alt_all:v0.2 | **FAIL** | 792 | 396 | 396.0 | 0.2694 | 0.7373 | 0.1873 | 0.0164 | -0.181 | ece_0.1873_gt_0.04 |
| ncaab:alt_all:v0.3 | **FAIL** | 792 | 396 | 396.0 | 0.2592 | 0.7112 | 0.1810 | 0.0149 | -0.169 | ece_0.1810_gt_0.04 |
| ncaab:closing_line_benchmark | **INSUFFICIENT_DATA** | 0 | 0 | 0.0 | n/a | n/a | n/a | n/a | 0.000 | closing_line_unavailable_unlicensed |
| ncaab:player_prop_named | **INSUFFICIENT_DATA** | 0 | 0 | 0.0 | n/a | n/a | n/a | n/a | 0.000 | named_player_prop_oos_not_wired_this_pass |

### Scoring distribution
| Dist | n | actMean | simMean | err | actVar | simVar | varRatio | actP90 | simP90 |
|------|---|---------|---------|-----|--------|--------|----------|--------|--------|
| ncaab_total_v0.2 | 396 | 146.93 | 149.39 | 2.46 | 319.05 | 35.01 | 0.11 | 169.0 | 156.7 |
| ncaab_margin_v0.2 | 396 | 2.77 | 3.18 | 0.41 | 172.49 | 26.94 | 0.16 | 18.0 | 9.7 |
| ncaab_total_v0.3 | 396 | 146.93 | 148.37 | 1.44 | 319.05 | 22.32 | 0.07 | 169.0 | 154.1 |
| ncaab_margin_v0.3 | 396 | 2.77 | 2.57 | -0.20 | 172.49 | 17.78 | 0.10 | 18.0 | 7.7 |

## Aggregate before/after rows
| Family | v0.2 ECE | v0.3 ECE | ΔECE | v0.2 Brier | v0.3 Brier | ΔBrier | v0.2 LL | v0.3 LL | mad½ 0.2→0.3 | shrink50? | n | v0.2 | v0.3 |
|--------|----------|----------|------|------------|------------|--------|---------|---------|--------------|-----------|---|------|------|
| nba:ml | 0.0482 | 0.0992 | 0.0510 | 0.2194 | 0.2301 | 0.0107 | 0.6295 | 0.6527 | 0.111→0.057 | no | 320 | **INSUFFICIENT_DATA** | **INSUFFICIENT_DATA** |
| nba:spread | 0.2811 | 0.2606 | -0.0205 | 0.2738 | 0.2655 | -0.0083 | 0.7484 | 0.7252 | 0.128→0.077 | YES | 640 | **FAIL** | **FAIL** |
| nba:total | 0.0645 | 0.0307 | -0.0338 | 0.2383 | 0.2355 | -0.0028 | 0.6726 | 0.6634 | 0.152→0.084 | YES | 640 | **FAIL** | **PASS** |
| nba:team_total | 0.0819 | 0.0446 | -0.0373 | 0.2344 | 0.2322 | -0.0022 | 0.6612 | 0.6568 | 0.160→0.073 | YES | 320 | **INSUFFICIENT_DATA** | **INSUFFICIENT_DATA** |
| nba:main_all | 0.0487 | 0.0612 | 0.0124 | 0.2322 | 0.2348 | 0.0026 | 0.6585 | 0.6623 | 0.137→0.068 | no | 1280 | **FAIL** | **FAIL** |
| nba:alt_all | 0.1895 | 0.1744 | -0.0151 | 0.2745 | 0.2624 | -0.0120 | 0.7494 | 0.7187 | 0.141→0.090 | YES | 640 | **FAIL** | **FAIL** |
| wnba:ml | 0.1217 | 0.1153 | -0.0064 | 0.2155 | 0.2250 | 0.0095 | 0.6214 | 0.6423 | 0.118→0.066 | no | 177 | **INSUFFICIENT_DATA** | **INSUFFICIENT_DATA** |
| wnba:spread | 0.2578 | 0.2455 | -0.0123 | 0.2770 | 0.2709 | -0.0061 | 0.7579 | 0.7374 | 0.139→0.093 | YES | 354 | **INSUFFICIENT_DATA** | **INSUFFICIENT_DATA** |
| wnba:total | 0.0652 | 0.0696 | 0.0044 | 0.2124 | 0.2191 | 0.0067 | 0.6135 | 0.6293 | 0.146→0.095 | no | 354 | **INSUFFICIENT_DATA** | **INSUFFICIENT_DATA** |
| wnba:team_total | 0.0781 | 0.0311 | -0.0470 | 0.2359 | 0.2365 | 0.0006 | 0.6643 | 0.6655 | 0.132→0.067 | YES | 177 | **INSUFFICIENT_DATA** | **INSUFFICIENT_DATA** |
| wnba:main_all | 0.0567 | 0.0803 | 0.0236 | 0.2270 | 0.2323 | 0.0053 | 0.6458 | 0.6572 | 0.123→0.068 | no | 708 | **FAIL** | **FAIL** |
| wnba:alt_all | 0.1763 | 0.1501 | -0.0262 | 0.2611 | 0.2561 | -0.0050 | 0.7225 | 0.7063 | 0.163→0.118 | YES | 354 | **INSUFFICIENT_DATA** | **INSUFFICIENT_DATA** |
| ncaab:ml | 0.0663 | 0.0798 | 0.0135 | 0.2126 | 0.2224 | 0.0099 | 0.6111 | 0.6360 | 0.137→0.074 | no | 396 | **INSUFFICIENT_DATA** | **INSUFFICIENT_DATA** |
| ncaab:spread | 0.3108 | 0.3028 | -0.0081 | 0.2789 | 0.2730 | -0.0059 | 0.7590 | 0.7407 | 0.144→0.091 | no | 792 | **FAIL** | **FAIL** |
| ncaab:total | 0.0792 | 0.0587 | -0.0205 | 0.2171 | 0.2174 | 0.0004 | 0.6216 | 0.6247 | 0.170→0.103 | YES | 792 | **FAIL** | **FAIL** |
| ncaab:team_total | 0.0936 | 0.0939 | 0.0002 | 0.2118 | 0.2169 | 0.0051 | 0.6087 | 0.6244 | 0.179→0.087 | no | 396 | **INSUFFICIENT_DATA** | **INSUFFICIENT_DATA** |
| ncaab:main_all | 0.0396 | 0.0752 | 0.0356 | 0.2194 | 0.2254 | 0.0061 | 0.6266 | 0.6421 | 0.155→0.081 | no | 1584 | **PASS** | **FAIL** |
| ncaab:alt_all | 0.1873 | 0.1810 | -0.0064 | 0.2694 | 0.2592 | -0.0102 | 0.7373 | 0.7112 | 0.162→0.113 | no | 792 | **FAIL** | **FAIL** |

- Production allowlists unchanged; SIM_V2_SERVE=off.