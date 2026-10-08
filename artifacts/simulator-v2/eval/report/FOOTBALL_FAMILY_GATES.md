# Football family gates — player props (holdout)

Thresholds: minOos=500, maxEce=0.04 (from `SIM_V2_ACCEPTANCE_THRESHOLDS`).

Verdicts: **PASS** | **FAIL** | **INSUFFICIENT_DATA**.

Closing-line rows are INSUFFICIENT until a licensed archive exists (`CLOSING_LINE_ARCHIVE.md`).

| Family | Verdict | n | games | effN | Brier | LogLoss | ECE | ECE_SE | bias | reasons |
|--------|---------|---|-------|------|-------|---------|-----|--------|------|---------|
| nfl:player_prop | **FAIL** | 6833 | 285 | 285.0 | 0.1578 | 0.4949 | 0.0375 | 0.0050 | -0.013 | overconfident_p95_hit_0.660_n_53 |
| nfl:player_prop:pass_yds | **PASS** | 2280 | 285 | 285.0 | 0.1625 | 0.4940 | 0.0252 | 0.0093 | -0.023 | — |
| nfl:player_prop:pass_yds:main | **FAIL** | 570 | 285 | 285.0 | 0.2358 | 0.6727 | 0.0706 | 0.0170 | -0.043 | ece_0.0706_gt_0.04 |
| nfl:player_prop:pass_yds:alt | **PASS** | 1710 | 285 | 285.0 | 0.1381 | 0.4344 | 0.0280 | 0.0071 | -0.016 | — |
| nfl:player_prop:rush_yds | **FAIL** | 2273 | 285 | 284.9 | 0.1705 | 0.5489 | 0.0821 | 0.0082 | -0.011 | ece_0.0821_gt_0.04; overconfident_p95_hit_0.660_n_53 |
| nfl:player_prop:rush_yds:main | **FAIL** | 570 | 285 | 285.0 | 0.2684 | 0.7387 | 0.1012 | 0.0187 | 0.021 | ece_0.1012_gt_0.04 |
| nfl:player_prop:rush_yds:alt | **FAIL** | 1703 | 285 | 284.8 | 0.1378 | 0.4853 | 0.0854 | 0.0082 | -0.021 | ece_0.0854_gt_0.04; overconfident_p95_hit_0.660_n_53 |
| nfl:player_prop:rec_yds | **FAIL** | 2280 | 285 | 285.0 | 0.1404 | 0.4420 | 0.0411 | 0.0066 | -0.004 | ece_0.0411_gt_0.04 |
| nfl:player_prop:rec_yds:main | **FAIL** | 570 | 285 | 285.0 | 0.1276 | 0.4283 | 0.0480 | 0.0130 | -0.022 | ece_0.0480_gt_0.04 |
| nfl:player_prop:rec_yds:alt | **FAIL** | 1710 | 285 | 285.0 | 0.1447 | 0.4465 | 0.0708 | 0.0074 | 0.002 | ece_0.0708_gt_0.04 |
| nfl:closing_line_benchmark | **INSUFFICIENT_DATA** | 0 | 0 | 0.0 | n/a | n/a | n/a | n/a | 0.000 | closing_line_unavailable_unlicensed; oos_sample_0_lt_500; ece_null_gt_0.04 |
| nfl:closing_line_vs_eval_grid | **INSUFFICIENT_DATA** | 0 | 0 | 0.0 | n/a | n/a | n/a | n/a | 0.000 | closing_line_unavailable_unlicensed; oos_sample_0_lt_500; ece_null_gt_0.04 |
| ncaaf:player_prop | **FAIL** | 9688 | 404 | 404.0 | 0.1821 | 0.5522 | 0.0742 | 0.0056 | 0.043 | ece_0.0742_gt_0.04 |
| ncaaf:player_prop:pass_yds | **FAIL** | 3232 | 404 | 404.0 | 0.1761 | 0.5234 | 0.1190 | 0.0106 | 0.119 | ece_0.1190_gt_0.04 |
| ncaaf:player_prop:pass_yds:main | **FAIL** | 808 | 404 | 404.0 | 0.2455 | 0.6848 | 0.1330 | 0.0173 | 0.133 | ece_0.1330_gt_0.04 |
| ncaaf:player_prop:pass_yds:alt | **FAIL** | 2424 | 404 | 404.0 | 0.1530 | 0.4695 | 0.1144 | 0.0098 | 0.114 | ece_0.1144_gt_0.04 |
| ncaaf:player_prop:rush_yds | **FAIL** | 3228 | 404 | 403.9 | 0.1910 | 0.5941 | 0.1070 | 0.0074 | -0.079 | ece_0.1070_gt_0.04 |
| ncaaf:player_prop:rush_yds:main | **FAIL** | 808 | 404 | 404.0 | 0.2564 | 0.7109 | 0.1187 | 0.0148 | -0.067 | ece_0.1187_gt_0.04 |
| ncaaf:player_prop:rush_yds:alt | **FAIL** | 2420 | 404 | 403.9 | 0.1692 | 0.5551 | 0.1046 | 0.0087 | -0.084 | ece_0.1046_gt_0.04 |
| ncaaf:player_prop:rec_yds | **FAIL** | 3228 | 404 | 403.8 | 0.1793 | 0.5391 | 0.0896 | 0.0099 | 0.088 | ece_0.0896_gt_0.04 |
| ncaaf:player_prop:rec_yds:main | **FAIL** | 807 | 404 | 403.8 | 0.2020 | 0.6142 | 0.1053 | 0.0166 | 0.105 | ece_0.1053_gt_0.04; overconfident_p90_hit_0.680_n_150 |
| ncaaf:player_prop:rec_yds:alt | **FAIL** | 2421 | 404 | 403.8 | 0.1717 | 0.5140 | 0.0990 | 0.0083 | 0.082 | ece_0.0990_gt_0.04 |
| ncaaf:closing_line_benchmark | **INSUFFICIENT_DATA** | 0 | 0 | 0.0 | n/a | n/a | n/a | n/a | 0.000 | closing_line_unavailable_unlicensed; oos_sample_0_lt_500; ece_null_gt_0.04 |
| ncaaf:closing_line_vs_eval_grid | **INSUFFICIENT_DATA** | 0 | 0 | 0.0 | n/a | n/a | n/a | n/a | 0.000 | closing_line_unavailable_unlicensed; oos_sample_0_lt_500; ece_null_gt_0.04 |

## Summary

- PASS=2 FAIL=18 INSUFFICIENT_DATA=4
- Prop model version: 0.3.2
- Production allowlist unchanged; serve remains off.
