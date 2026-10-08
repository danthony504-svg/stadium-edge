# Football family gates — player props (holdout)

Thresholds: minOos=500, maxEce=0.04 (from `SIM_V2_ACCEPTANCE_THRESHOLDS`).

Verdicts: **PASS** | **FAIL** | **INSUFFICIENT_DATA**.

Closing-line rows are INSUFFICIENT until a licensed archive exists (`CLOSING_LINE_ARCHIVE.md`).

| Family | Verdict | n | games | effN | Brier | LogLoss | ECE | ECE_SE | bias | reasons |
|--------|---------|---|-------|------|-------|---------|-----|--------|------|---------|
| nfl:player_prop | **FAIL** | 6840 | 285 | 285.0 | 0.2192 | 0.6487 | 0.2173 | 0.0072 | 0.217 | ece_0.2173_gt_0.04; overconfident_p95_hit_0.457_n_105 |
| nfl:player_prop:pass_yds | **FAIL** | 2280 | 285 | 285.0 | 0.2069 | 0.6065 | 0.2075 | 0.0125 | 0.208 | ece_0.2075_gt_0.04; overconfident_p90_hit_0.746_n_71 |
| nfl:player_prop:pass_yds:main | **FAIL** | 570 | 285 | 285.0 | 0.2941 | 0.7915 | 0.2498 | 0.0217 | 0.244 | ece_0.2498_gt_0.04 |
| nfl:player_prop:pass_yds:alt | **FAIL** | 1710 | 285 | 285.0 | 0.1778 | 0.5448 | 0.1953 | 0.0104 | 0.195 | ece_0.1953_gt_0.04; overconfident_p90_hit_0.746_n_71 |
| nfl:player_prop:rush_yds | **FAIL** | 2280 | 285 | 285.0 | 0.2409 | 0.7293 | 0.2512 | 0.0113 | 0.250 | ece_0.2512_gt_0.04; overconfident_p90_hit_0.751_n_736; overconfident_p95_hit_0.457_n_105 |
| nfl:player_prop:rush_yds:main | **FAIL** | 570 | 285 | 285.0 | 0.3776 | 1.1356 | 0.3539 | 0.0199 | 0.354 | ece_0.3539_gt_0.04; overconfident_p90_hit_0.530_n_166; overconfident_p95_hit_0.255_n_51 |
| nfl:player_prop:rush_yds:alt | **FAIL** | 1710 | 285 | 285.0 | 0.1953 | 0.5938 | 0.2170 | 0.0093 | 0.215 | ece_0.2170_gt_0.04; overconfident_p95_hit_0.648_n_54 |
| nfl:player_prop:rec_yds | **FAIL** | 2280 | 285 | 285.0 | 0.2096 | 0.6104 | 0.1946 | 0.0106 | 0.195 | ece_0.1946_gt_0.04 |
| nfl:player_prop:rec_yds:main | **FAIL** | 570 | 285 | 285.0 | 0.1264 | 0.4294 | 0.0602 | 0.0154 | 0.060 | ece_0.0602_gt_0.04 |
| nfl:player_prop:rec_yds:alt | **FAIL** | 1710 | 285 | 285.0 | 0.2374 | 0.6707 | 0.2395 | 0.0119 | 0.239 | ece_0.2395_gt_0.04 |
| nfl:closing_line_benchmark | **INSUFFICIENT_DATA** | 0 | 0 | 0.0 | n/a | n/a | n/a | n/a | 0.000 | oos_sample_0_lt_500; ece_null_gt_0.04 |
| nfl:closing_line_vs_eval_grid | **INSUFFICIENT_DATA** | 0 | 0 | 0.0 | n/a | n/a | n/a | n/a | 0.000 | oos_sample_0_lt_500; ece_null_gt_0.04 |
| ncaaf:player_prop | **FAIL** | 9692 | 404 | 404.0 | 0.2675 | 0.7728 | 0.2799 | 0.0071 | 0.280 | ece_0.2799_gt_0.04; overconfident_p90_hit_0.765_n_3277; overconfident_p95_hit_0.711_n_225 |
| ncaaf:player_prop:pass_yds | **FAIL** | 3232 | 404 | 404.0 | 0.2891 | 0.8226 | 0.3521 | 0.0106 | 0.352 | ece_0.3521_gt_0.04; overconfident_p90_hit_0.588_n_447; overconfident_p95_hit_0.667_n_60 |
| ncaaf:player_prop:pass_yds:main | **FAIL** | 808 | 404 | 404.0 | 0.3804 | 1.0250 | 0.3970 | 0.0177 | 0.397 | ece_0.3970_gt_0.04; overconfident_p90_hit_0.426_n_47 |
| ncaaf:player_prop:pass_yds:alt | **FAIL** | 2424 | 404 | 404.0 | 0.2587 | 0.7551 | 0.3371 | 0.0099 | 0.337 | ece_0.3371_gt_0.04; overconfident_p90_hit_0.608_n_400; overconfident_p95_hit_0.667_n_60 |
| ncaaf:player_prop:rush_yds | **FAIL** | 3232 | 404 | 404.0 | 0.2372 | 0.6982 | 0.2139 | 0.0106 | 0.214 | ece_0.2139_gt_0.04; overconfident_p95_hit_0.727_n_165 |
| ncaaf:player_prop:rush_yds:main | **FAIL** | 808 | 404 | 404.0 | 0.3340 | 0.9867 | 0.3004 | 0.0161 | 0.300 | ece_0.3004_gt_0.04; overconfident_p90_hit_0.589_n_192; overconfident_p95_hit_0.500_n_70 |
| ncaaf:player_prop:rush_yds:alt | **FAIL** | 2424 | 404 | 404.0 | 0.2049 | 0.6020 | 0.1851 | 0.0105 | 0.185 | ece_0.1851_gt_0.04 |
| ncaaf:player_prop:rec_yds | **FAIL** | 3228 | 404 | 403.8 | 0.2763 | 0.7978 | 0.2736 | 0.0106 | 0.274 | ece_0.2736_gt_0.04; overconfident_p90_hit_0.780_n_1801 |
| ncaaf:player_prop:rec_yds:main | **FAIL** | 807 | 404 | 403.8 | 0.2279 | 0.7199 | 0.1824 | 0.0169 | 0.182 | ece_0.1824_gt_0.04; overconfident_p90_hit_0.745_n_768 |
| ncaaf:player_prop:rec_yds:alt | **FAIL** | 2421 | 404 | 403.8 | 0.2924 | 0.8237 | 0.3040 | 0.0101 | 0.304 | ece_0.3040_gt_0.04 |
| ncaaf:closing_line_benchmark | **INSUFFICIENT_DATA** | 0 | 0 | 0.0 | n/a | n/a | n/a | n/a | 0.000 | oos_sample_0_lt_500; ece_null_gt_0.04 |
| ncaaf:closing_line_vs_eval_grid | **INSUFFICIENT_DATA** | 0 | 0 | 0.0 | n/a | n/a | n/a | n/a | 0.000 | oos_sample_0_lt_500; ece_null_gt_0.04 |

## Summary

- PASS=0 FAIL=20 INSUFFICIENT_DATA=4
- Prop model version: 0.3.1
- Production allowlist unchanged; serve remains off.
