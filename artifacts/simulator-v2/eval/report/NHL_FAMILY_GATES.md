# NHL sport:family gates

Shadow-only. Thresholds: minOos=500, maxEce=0.04.

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
