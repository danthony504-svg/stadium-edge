# Phase C.2.1 — Football player prop chronological OOS (named-player)

Shadow-only. No `SIM_V2_SERVE`, no allowlists, no Coach/P0 wiring.

- Prop model: `football.props` @ **0.3.1** (yard-budget shock σ=0.12; pass mean trimmed).
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
- Settled prop observations (holdout): 6840 (main=1710, alt=5130)
- Gate minOosSample=500: **met** (n=6840)
- Mean runtime/game: 198.4 ms
- Serve/allowlist: **off** / empty

## Holdout family gates

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

## Distribution compare (sim mean vs actual leader yards)

| Dist | n | actMean | simMean | err | actVar | simVar | varRatio | actP90 | simP90 |
|------|---|---------|---------|-----|--------|--------|----------|--------|--------|
| nfl:pass_yds | 570 | 228.03 | 282.80 | 54.77 | 5164.64 | 934.86 | 0.18 | 323.0 | 322.4 |
| nfl:rush_yds | 570 | 72.58 | 105.53 | 32.95 | 1309.15 | 172.31 | 0.13 | 119.0 | 120.9 |
| nfl:rec_yds | 570 | 86.25 | 130.49 | 44.24 | 1035.41 | 699.33 | 0.68 | 125.0 | 168.1 |

## Reliability (holdout overall)

| bin | n | avgPred | avgY | gap |
|-----|---|---------|------|-----|
| 0.0-0.1 | 99 | 0.066 | 0.051 | 0.015 |
| 0.1-0.2 | 410 | 0.155 | 0.059 | 0.096 |
| 0.2-0.3 | 527 | 0.252 | 0.076 | 0.176 |
| 0.3-0.4 | 505 | 0.348 | 0.127 | 0.222 |
| 0.4-0.5 | 579 | 0.451 | 0.173 | 0.278 |
| 0.5-0.6 | 610 | 0.551 | 0.216 | 0.335 |
| 0.6-0.7 | 513 | 0.648 | 0.314 | 0.334 |
| 0.7-0.8 | 565 | 0.751 | 0.425 | 0.326 |
| 0.8-0.9 | 1030 | 0.859 | 0.525 | 0.333 |
| 0.9-1.0 | 2002 | 0.921 | 0.832 | 0.088 |

## Extreme alt overconfidence bands (holdout alts)

- n=5130; ECE=0.2166; overconf80 hit=0.750 (n=1887); overconf90=0.859 (n=1283); overconf95=0.648 (n=54)
- Reasons: ece_0.2166_gt_0.04; overconfident_p95_hit_0.648_n_54

## Val fold (diagnostic only — not used for gates)

### nfl / val (NFL 2023) — diagnostic

- Games attempted: 40
- Games with named leaders: 40
- Distinct named athletes: 138
- Observations: 960 (main=240, alt=720)
- Runtime: 7.8s (mean 194 ms/game)

## Notes / root causes addressed

1. **Proxy identity mismatch** — prior OOS modeled synthetic `home_qb`/`home_rb` while grading game leaders; now models ESPN `athlete.id`.
2. **Pass yard budget overconfidence** — teamYardBudget pass coefficient trimmed; multiplicative lognormal shock σ=0.12 on pass/rush/rec budgets per draw.
3. **Closing lines** — INSUFFICIENT (no licensed archive); eval-grid −110 only.

# NCAAF

- Holdout label: NCAAF 2024 weeks 8–15
- Holdout games attempted: 404
- Games with named ESPN leaders: 404
- Distinct named athletes (holdout): 879
- Settled prop observations (holdout): 9692 (main=2423, alt=7269)
- Gate minOosSample=500: **met** (n=9692)
- Mean runtime/game: 223.8 ms
- Serve/allowlist: **off** / empty

## Holdout family gates

| Family | Verdict | n | games | effN | Brier | LogLoss | ECE | ECE_SE | bias | reasons |
|--------|---------|---|-------|------|-------|---------|-----|--------|------|---------|
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

## Distribution compare (sim mean vs actual leader yards)

| Dist | n | actMean | simMean | err | actVar | simVar | varRatio | actP90 | simP90 |
|------|---|---------|---------|-----|--------|--------|----------|--------|--------|
| ncaaf:pass_yds | 808 | 209.14 | 315.09 | 105.95 | 7281.83 | 1768.97 | 0.24 | 319.0 | 371.5 |
| ncaaf:rush_yds | 808 | 88.91 | 117.05 | 28.14 | 1936.75 | 318.47 | 0.16 | 147.0 | 140.8 |
| ncaaf:rec_yds | 807 | 83.80 | 148.32 | 64.52 | 1340.41 | 1261.08 | 0.94 | 131.0 | 205.1 |

## Reliability (holdout overall)

| bin | n | avgPred | avgY | gap |
|-----|---|---------|------|-----|
| 0.0-0.1 | 64 | 0.069 | 0.016 | 0.054 |
| 0.1-0.2 | 242 | 0.156 | 0.045 | 0.110 |
| 0.2-0.3 | 432 | 0.252 | 0.063 | 0.190 |
| 0.3-0.4 | 611 | 0.351 | 0.111 | 0.240 |
| 0.4-0.5 | 613 | 0.450 | 0.139 | 0.311 |
| 0.5-0.6 | 749 | 0.549 | 0.190 | 0.360 |
| 0.6-0.7 | 880 | 0.650 | 0.250 | 0.400 |
| 0.7-0.8 | 998 | 0.752 | 0.332 | 0.421 |
| 0.8-0.9 | 1826 | 0.856 | 0.469 | 0.387 |
| 0.9-1.0 | 3277 | 0.922 | 0.765 | 0.157 |

## Extreme alt overconfidence bands (holdout alts)

- n=7269; ECE=0.2754; overconf80 hit=0.682 (n=3233); overconf90=0.793 (n=2270); overconf95=0.806 (n=155)
- Reasons: ece_0.2754_gt_0.04; overconfident_p90_hit_0.793_n_2270; overconfident_p95_hit_0.806_n_155

## Val fold (diagnostic only — not used for gates)

### ncaaf / val (NCAAF 2024 weeks 1–7) — diagnostic

- Games attempted: 40
- Games with named leaders: 40
- Distinct named athletes: 216
- Observations: 960 (main=240, alt=720)
- Runtime: 8.3s (mean 208 ms/game)

## Notes / root causes addressed

1. **Proxy identity mismatch** — prior OOS modeled synthetic `home_qb`/`home_rb` while grading game leaders; now models ESPN `athlete.id`.
2. **Pass yard budget overconfidence** — teamYardBudget pass coefficient trimmed; multiplicative lognormal shock σ=0.12 on pass/rush/rec budgets per draw.
3. **Closing lines** — INSUFFICIENT (no licensed archive); eval-grid −110 only.
