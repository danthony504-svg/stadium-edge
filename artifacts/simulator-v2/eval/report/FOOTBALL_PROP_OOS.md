# Phase C.2.2 — Football player prop chronological OOS (named-player)

Shadow-only. No `SIM_V2_SERVE`, no allowlists, no Coach/P0 wiring.

- Prop model: `football.props` @ **0.3.2** (yard-budget shock σ=0.12; val-fold mean scales).
- Draws/game: 2000 (CI deep contract 10000).
- Odds: **eval-grid −110** (explicitly **not** closing lines; archive unlicensed → INSUFFICIENT).
- Identity: ESPN boxscore `athlete.id` + `displayName` + team id; side must match game record.
- Participation: QB leaders `confirmed_starter`; skill leaders `active`.
- Form: walk-forward prior games only (`selectEligibleGames` / `formBeforeKickoff`).
- Gates: **holdout only**; train unused for props; val diagnostic only.

# NFL

- Holdout label: NFL 2024
- Holdout games attempted: 285
- Games with named ESPN leaders: 285
- Distinct named athletes (holdout): 297
- Settled prop observations (holdout): 6833 (main=1710, alt=5123)
- Gate minOosSample=500: **met** (n=6833)
- Mean runtime/game: 15.7 ms
- Serve/allowlist: **off** / empty

## Holdout family gates

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

## Distribution compare (sim mean vs actual leader yards)

| Dist | n | actMean | simMean | err | actVar | simVar | varRatio | actP90 | simP90 |
|------|---|---------|---------|-----|--------|--------|----------|--------|--------|
| nfl:pass_yds | 570 | 228.03 | 221.74 | -6.29 | 5164.64 | 546.49 | 0.11 | 323.0 | 252.2 |
| nfl:rush_yds | 570 | 72.58 | 67.85 | -4.72 | 1309.15 | 69.63 | 0.05 | 119.0 | 77.4 |
| nfl:rec_yds | 570 | 86.25 | 87.00 | 0.76 | 1035.41 | 309.99 | 0.30 | 125.0 | 112.4 |

## Reliability (holdout overall)

| bin | n | avgPred | avgY | gap |
|-----|---|---------|------|-----|
| 0.0-0.1 | 1639 | 0.045 | 0.098 | -0.053 |
| 0.1-0.2 | 969 | 0.143 | 0.181 | -0.037 |
| 0.2-0.3 | 542 | 0.247 | 0.266 | -0.019 |
| 0.3-0.4 | 463 | 0.350 | 0.397 | -0.048 |
| 0.4-0.5 | 483 | 0.449 | 0.476 | -0.027 |
| 0.5-0.6 | 445 | 0.549 | 0.535 | 0.014 |
| 0.6-0.7 | 360 | 0.648 | 0.600 | 0.048 |
| 0.7-0.8 | 270 | 0.753 | 0.704 | 0.049 |
| 0.8-0.9 | 793 | 0.862 | 0.801 | 0.061 |
| 0.9-1.0 | 869 | 0.919 | 0.922 | -0.003 |

## Extreme alt overconfidence bands (holdout alts)

- n=5123; ECE=0.0401; overconf80 hit=0.876 (n=1188); overconf90=0.931 (n=800); overconf95=0.660 (n=53)
- Reasons: ece_0.0401_gt_0.04; overconfident_p95_hit_0.660_n_53

## Val fold (diagnostic only — not used for gates)

### nfl / val (NFL 2023) — diagnostic

- Games attempted: 5
- Games with named leaders: 5
- Distinct named athletes: 28
- Observations: 120 (main=30, alt=90)
- Runtime: 0.1s (mean 15 ms/game)

## Notes / root causes addressed

1. **Proxy identity mismatch** — prior OOS modeled synthetic `home_qb`/`home_rb` while grading game leaders; now models ESPN `athlete.id`.
2. **Pass yard budget overconfidence** — teamYardBudget pass coefficient trimmed; multiplicative lognormal shock σ=0.12 on pass/rush/rec budgets per draw.
3. **Closing lines** — INSUFFICIENT (no licensed archive); eval-grid −110 only.

# NCAAF

- Holdout label: NCAAF 2024 weeks 8–15
- Holdout games attempted: 404
- Games with named ESPN leaders: 404
- Distinct named athletes (holdout): 879
- Settled prop observations (holdout): 9688 (main=2423, alt=7265)
- Gate minOosSample=500: **met** (n=9688)
- Mean runtime/game: 15.3 ms
- Serve/allowlist: **off** / empty

## Holdout family gates

| Family | Verdict | n | games | effN | Brier | LogLoss | ECE | ECE_SE | bias | reasons |
|--------|---------|---|-------|------|-------|---------|-----|--------|------|---------|
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

## Distribution compare (sim mean vs actual leader yards)

| Dist | n | actMean | simMean | err | actVar | simVar | varRatio | actP90 | simP90 |
|------|---|---------|---------|-----|--------|--------|----------|--------|--------|
| ncaaf:pass_yds | 808 | 209.14 | 246.27 | 37.13 | 7281.83 | 1026.89 | 0.14 | 319.0 | 288.9 |
| ncaaf:rush_yds | 808 | 88.91 | 75.12 | -13.79 | 1936.75 | 126.45 | 0.07 | 147.0 | 89.7 |
| ncaaf:rec_yds | 807 | 83.80 | 98.74 | 14.94 | 1340.41 | 550.09 | 0.41 | 131.0 | 137.4 |

## Reliability (holdout overall)

| bin | n | avgPred | avgY | gap |
|-----|---|---------|------|-----|
| 0.0-0.1 | 1484 | 0.047 | 0.121 | -0.073 |
| 0.1-0.2 | 1226 | 0.148 | 0.184 | -0.036 |
| 0.2-0.3 | 933 | 0.248 | 0.226 | 0.021 |
| 0.3-0.4 | 756 | 0.348 | 0.307 | 0.042 |
| 0.4-0.5 | 745 | 0.451 | 0.404 | 0.047 |
| 0.5-0.6 | 723 | 0.549 | 0.454 | 0.095 |
| 0.6-0.7 | 607 | 0.649 | 0.494 | 0.155 |
| 0.7-0.8 | 637 | 0.751 | 0.531 | 0.221 |
| 0.8-0.9 | 1002 | 0.860 | 0.712 | 0.148 |
| 0.9-1.0 | 1575 | 0.919 | 0.902 | 0.017 |

## Extreme alt overconfidence bands (holdout alts)

- n=7265; ECE=0.0805; overconf80 hit=0.851 (n=1926); overconf90=0.925 (n=1422); overconf95=0.914 (n=93)
- Reasons: ece_0.0805_gt_0.04

## Val fold (diagnostic only — not used for gates)

### ncaaf / val (NCAAF 2024 weeks 1–7) — diagnostic

- Games attempted: 5
- Games with named leaders: 5
- Distinct named athletes: 29
- Observations: 120 (main=30, alt=90)
- Runtime: 0.1s (mean 16 ms/game)

## Notes / root causes addressed

1. **Proxy identity mismatch** — prior OOS modeled synthetic `home_qb`/`home_rb` while grading game leaders; now models ESPN `athlete.id`.
2. **Pass yard budget overconfidence** — teamYardBudget pass coefficient trimmed; multiplicative lognormal shock σ=0.12 on pass/rush/rec budgets per draw.
3. **Closing lines** — INSUFFICIENT (no licensed archive); eval-grid −110 only.
