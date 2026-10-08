# Basketball A/B family gates

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
