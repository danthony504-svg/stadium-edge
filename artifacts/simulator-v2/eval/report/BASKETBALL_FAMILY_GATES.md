# Basketball sport:family gates

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
