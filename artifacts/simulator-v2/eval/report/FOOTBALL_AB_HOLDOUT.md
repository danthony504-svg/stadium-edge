# Football prop A/B holdout — prior v0.2 vs calibrated v0.3.2

Shadow-only independent OOS. Identical chrono holdout games for both profiles.
**Named ESPN `athlete.id` only** — `home_qb` / missing identity rejected (not graded).

- Profiles: `v0.2` → model **0.2.0** (pass 8.5·pts+120, rush 3.2·pts+60, rec 5.5·pts+80, **no** yardBudgetShock); `v0.3.2` → model **0.3.2** (current means + σ=0.12 shock).
- Draws/game: 2000 (CI deep contract 10000).
- Odds: eval-grid −110 (not closing lines).
- Gates unchanged: minOos=500, maxEce=0.04.
- No serve / allowlists / Coach / P0 / OTA.

# NFL

- Holdout label: NFL 2024
- Holdout games (identical for A/B): 285
- Games with named leaders: v0.2=285 / v0.3.2=285
- Distinct named athletes: v0.2=297 / v0.3.2=297
- Rejected proxy/missing identity (not graded): v0.2=0 / v0.3.2=0
- Settled obs (paired): 8480 (dropped unpaired v0.2=4 v0.3.2=0)
- Runtime p95 ms/game: v0.2=20.6 / v0.3.2=18.0
- Proxy players graded: **none** (asserted)

## Before/after by family (v0.2 → v0.3.2)

| Family | v0.2 (prior) | v0.3.2 (calibrated) | MAD½ v0.2 | MAD½ v0.3.2 | shrink-to-50 |
|--------|--------------|---------------------|-----------|-------------|--------------|
| nfl:closing_line_benchmark | **INSUFFICIENT_DATA** n=0 Brier=n/a LL=n/a ECE=n/a SE=n/a | **INSUFFICIENT_DATA** n=0 Brier=n/a LL=n/a ECE=n/a SE=n/a | 0.000 | 0.000 | no_observations |
| nfl:player_prop | **FAIL** n=8480 Brier=0.2436 LL=0.7125 ECE=0.2235 SE=0.0073 | **FAIL** n=8480 Brier=0.1735 LL=0.5306 ECE=0.0587 SE=0.0047 | 0.283 | 0.302 | ok_dispersion |
| nfl:player_prop:any_td | **FAIL** n=1644 Brier=0.2396 LL=0.6810 ECE=0.1459 SE=0.0096 | **FAIL** n=1644 Brier=0.2394 LL=0.6808 ECE=0.1465 SE=0.0100 | 0.268 | 0.268 | ok_dispersion |
| nfl:player_prop:any_td:main | **FAIL** n=1644 Brier=0.2396 LL=0.6810 ECE=0.1459 SE=0.0095 | **FAIL** n=1644 Brier=0.2394 LL=0.6808 ECE=0.1465 SE=0.0097 | 0.268 | 0.268 | ok_dispersion |
| nfl:player_prop:pass_yds | **FAIL** n=2279 Brier=0.2701 LL=0.7755 ECE=0.3204 SE=0.0126 | **PASS** n=2279 Brier=0.1627 LL=0.4949 ECE=0.0251 SE=0.0095 | 0.238 | 0.275 | ok_dispersion |
| nfl:player_prop:pass_yds:alt | **FAIL** n=1709 Brier=0.2349 LL=0.7007 ECE=0.3011 SE=0.0112 | **PASS** n=1709 Brier=0.1382 LL=0.4354 ECE=0.0320 SE=0.0073 | 0.235 | 0.304 | ok_dispersion |
| nfl:player_prop:pass_yds:main | **FAIL** n=570 Brier=0.3756 LL=0.9999 ECE=0.3834 SE=0.0208 | **FAIL** n=570 Brier=0.2361 LL=0.6736 ECE=0.0668 SE=0.0183 | 0.245 | 0.189 | ok_dispersion |
| nfl:player_prop:rec_yds | **FAIL** n=2280 Brier=0.2161 LL=0.6305 ECE=0.2029 SE=0.0112 | **FAIL** n=2280 Brier=0.1403 LL=0.4412 ECE=0.0444 SE=0.0068 | 0.319 | 0.313 | ok_dispersion |
| nfl:player_prop:rec_yds:alt | **FAIL** n=1710 Brier=0.2458 LL=0.6960 ECE=0.2496 SE=0.0111 | **FAIL** n=1710 Brier=0.1446 LL=0.4460 ECE=0.0747 SE=0.0080 | 0.285 | 0.305 | ok_dispersion |
| nfl:player_prop:rec_yds:main | **FAIL** n=570 Brier=0.1271 LL=0.4339 ECE=0.0628 SE=0.0152 | **FAIL** n=570 Brier=0.1273 LL=0.4266 ECE=0.0464 SE=0.0127 | 0.419 | 0.335 | ok_dispersion |
| nfl:player_prop:rush_yds | **FAIL** n=2277 Brier=0.2475 LL=0.7544 ECE=0.2569 SE=0.0099 | **FAIL** n=2277 Brier=0.1701 LL=0.5476 ECE=0.0812 SE=0.0082 | 0.304 | 0.342 | ok_dispersion |
| nfl:player_prop:rush_yds:alt | **FAIL** n=1707 Brier=0.2004 LL=0.6069 ECE=0.2196 SE=0.0092 | **FAIL** n=1707 Brier=0.1374 LL=0.4841 ECE=0.0840 SE=0.0089 | 0.271 | 0.419 | over_sharp_vs_50 |
| nfl:player_prop:rush_yds:main | **FAIL** n=570 Brier=0.3886 LL=1.1962 ECE=0.3687 SE=0.0179 | **FAIL** n=570 Brier=0.2680 LL=0.7378 ECE=0.0979 SE=0.0171 | 0.402 | 0.110 | ok_dispersion |

## NFL profile v0.2 (model 0.2.0)

- n=8480 games=285 effN≈ named athletes 297
- Brier=0.2436 LogLoss=0.7125 ECE=0.2235 bias=0.223
- meanAbsDevFromHalf=0.283 fracNearHalf(|p−0.5|≤0.05)=0.072 fracExtreme(p≤0.1|p≥0.9)=0.348 → **ok_dispersion**
- overconf80 hit=0.714 (n=4081); overconf90=0.788 (n=2879); overconf95=0.554 (n=175)
- runtime: total=4.8s mean=16.8ms/game p95=20.6ms

### Family gates

| Family | Verdict | n | games | effN | Brier | LogLoss | ECE | ECE_SE | bias | reasons |
|--------|---------|---|-------|------|-------|---------|-----|--------|------|---------|
| nfl:v0.2:player_prop | **FAIL** | 8480 | 285 | 284.9 | 0.2436 | 0.7125 | 0.2235 | 0.0073 | 0.223 | ece_0.2235_gt_0.04; overconfident_p90_hit_0.788_n_2879; overconfident_p95_hit_0.554_n_175 |
| nfl:v0.2:player_prop:pass_yds | **FAIL** | 2279 | 285 | 285.0 | 0.2701 | 0.7755 | 0.3204 | 0.0126 | 0.320 | ece_0.3204_gt_0.04; overconfident_p90_hit_0.684_n_396; overconfident_p95_hit_0.710_n_62 |
| nfl:v0.2:player_prop:pass_yds:main | **FAIL** | 570 | 285 | 285.0 | 0.3756 | 0.9999 | 0.3834 | 0.0208 | 0.378 | ece_0.3834_gt_0.04 |
| nfl:v0.2:player_prop:pass_yds:alt | **FAIL** | 1709 | 285 | 285.0 | 0.2349 | 0.7007 | 0.3011 | 0.0112 | 0.301 | ece_0.3011_gt_0.04; overconfident_p90_hit_0.693_n_387; overconfident_p95_hit_0.710_n_62 |
| nfl:v0.2:player_prop:rush_yds | **FAIL** | 2277 | 285 | 285.0 | 0.2475 | 0.7544 | 0.2569 | 0.0099 | 0.256 | ece_0.2569_gt_0.04; overconfident_p90_hit_0.699_n_900; overconfident_p95_hit_0.449_n_107 |
| nfl:v0.2:player_prop:rush_yds:main | **FAIL** | 570 | 285 | 285.0 | 0.3886 | 1.1962 | 0.3687 | 0.0179 | 0.369 | ece_0.3687_gt_0.04; overconfident_p90_hit_0.509_n_324; overconfident_p95_hit_0.245_n_53 |
| nfl:v0.2:player_prop:rush_yds:alt | **FAIL** | 1707 | 285 | 284.9 | 0.2004 | 0.6069 | 0.2196 | 0.0092 | 0.219 | ece_0.2196_gt_0.04; overconfident_p95_hit_0.648_n_54 |
| nfl:v0.2:player_prop:rec_yds | **FAIL** | 2280 | 285 | 285.0 | 0.2161 | 0.6305 | 0.2029 | 0.0112 | 0.203 | ece_0.2029_gt_0.04 |
| nfl:v0.2:player_prop:rec_yds:main | **FAIL** | 570 | 285 | 285.0 | 0.1271 | 0.4339 | 0.0628 | 0.0152 | 0.063 | ece_0.0628_gt_0.04 |
| nfl:v0.2:player_prop:rec_yds:alt | **FAIL** | 1710 | 285 | 285.0 | 0.2458 | 0.6960 | 0.2496 | 0.0111 | 0.250 | ece_0.2496_gt_0.04 |
| nfl:v0.2:player_prop:any_td | **FAIL** | 1644 | 285 | 283.3 | 0.2396 | 0.6810 | 0.1459 | 0.0096 | 0.072 | ece_0.1459_gt_0.04 |
| nfl:v0.2:player_prop:any_td:main | **FAIL** | 1644 | 285 | 283.3 | 0.2396 | 0.6810 | 0.1459 | 0.0095 | 0.072 | ece_0.1459_gt_0.04 |
| nfl:v0.2:closing_line_benchmark | **INSUFFICIENT_DATA** | 0 | 0 | 0.0 | n/a | n/a | n/a | n/a | 0.000 | closing_line_unavailable_unlicensed; oos_sample_0_lt_500; ece_null_gt_0.04 |

### Dist compare

| Dist | n | actMean | simMean | err | actVar | simVar | varRatio | actP90 | simP90 |
|------|---|---------|---------|-----|--------|--------|----------|--------|--------|
| nfl:pass_yds | 570 | 228.03 | 313.68 | 85.65 | 5164.64 | 1156.59 | 0.22 | 323.0 | 359.5 |
| nfl:any_td | 1644 | 0.97 | 0.67 | -0.30 | 1.11 | 0.06 | 0.05 | 2.0 | 0.9 |
| nfl:rush_yds | 570 | 72.58 | 105.63 | 33.05 | 1309.15 | 171.77 | 0.13 | 119.0 | 121.3 |
| nfl:rec_yds | 570 | 86.25 | 130.60 | 44.36 | 1035.41 | 701.67 | 0.68 | 125.0 | 168.5 |

### Reliability

| bin | n | avgPred | avgY | gap |
|-----|---|---------|------|-----|
| 0.0-0.1 | 74 | 0.068 | 0.068 | 0.000 |
| 0.1-0.2 | 276 | 0.157 | 0.065 | 0.091 |
| 0.2-0.3 | 507 | 0.255 | 0.142 | 0.113 |
| 0.3-0.4 | 764 | 0.352 | 0.258 | 0.094 |
| 0.4-0.5 | 641 | 0.448 | 0.198 | 0.250 |
| 0.5-0.6 | 592 | 0.549 | 0.171 | 0.379 |
| 0.6-0.7 | 622 | 0.651 | 0.243 | 0.408 |
| 0.7-0.8 | 923 | 0.752 | 0.399 | 0.353 |
| 0.8-0.9 | 1202 | 0.859 | 0.536 | 0.324 |
| 0.9-1.0 | 2879 | 0.922 | 0.788 | 0.134 |

## NFL profile v0.3.2 (model 0.3.2)

- n=8480 games=285 effN≈ named athletes 297
- Brier=0.1735 LogLoss=0.5306 ECE=0.0587 bias=0.004
- meanAbsDevFromHalf=0.302 fracNearHalf(|p−0.5|≤0.05)=0.060 fracExtreme(p≤0.1|p≥0.9)=0.339 → **ok_dispersion**
- overconf80 hit=0.845 (n=2310); overconf90=0.898 (n=1243); overconf95=0.700 (n=60)
- runtime: total=4.8s mean=16.8ms/game p95=18.0ms

### Family gates

| Family | Verdict | n | games | effN | Brier | LogLoss | ECE | ECE_SE | bias | reasons |
|--------|---------|---|-------|------|-------|---------|-----|--------|------|---------|
| nfl:v0.3.2:player_prop | **FAIL** | 8480 | 285 | 284.9 | 0.1735 | 0.5306 | 0.0587 | 0.0047 | 0.004 | ece_0.0587_gt_0.04; overconfident_p95_hit_0.700_n_60 |
| nfl:v0.3.2:player_prop:pass_yds | **PASS** | 2279 | 285 | 285.0 | 0.1627 | 0.4949 | 0.0251 | 0.0095 | -0.022 | — |
| nfl:v0.3.2:player_prop:pass_yds:main | **FAIL** | 570 | 285 | 285.0 | 0.2361 | 0.6736 | 0.0668 | 0.0183 | -0.042 | ece_0.0668_gt_0.04 |
| nfl:v0.3.2:player_prop:pass_yds:alt | **PASS** | 1709 | 285 | 285.0 | 0.1382 | 0.4354 | 0.0320 | 0.0073 | -0.015 | — |
| nfl:v0.3.2:player_prop:rush_yds | **FAIL** | 2277 | 285 | 285.0 | 0.1701 | 0.5476 | 0.0812 | 0.0082 | -0.010 | ece_0.0812_gt_0.04; overconfident_p95_hit_0.673_n_52 |
| nfl:v0.3.2:player_prop:rush_yds:main | **FAIL** | 570 | 285 | 285.0 | 0.2680 | 0.7378 | 0.0979 | 0.0171 | 0.022 | ece_0.0979_gt_0.04 |
| nfl:v0.3.2:player_prop:rush_yds:alt | **FAIL** | 1707 | 285 | 284.9 | 0.1374 | 0.4841 | 0.0840 | 0.0089 | -0.021 | ece_0.0840_gt_0.04; overconfident_p95_hit_0.673_n_52 |
| nfl:v0.3.2:player_prop:rec_yds | **FAIL** | 2280 | 285 | 285.0 | 0.1403 | 0.4412 | 0.0444 | 0.0068 | -0.004 | ece_0.0444_gt_0.04 |
| nfl:v0.3.2:player_prop:rec_yds:main | **FAIL** | 570 | 285 | 285.0 | 0.1273 | 0.4266 | 0.0464 | 0.0127 | -0.022 | ece_0.0464_gt_0.04 |
| nfl:v0.3.2:player_prop:rec_yds:alt | **FAIL** | 1710 | 285 | 285.0 | 0.1446 | 0.4460 | 0.0747 | 0.0080 | 0.002 | ece_0.0747_gt_0.04 |
| nfl:v0.3.2:player_prop:any_td | **FAIL** | 1644 | 285 | 283.3 | 0.2394 | 0.6808 | 0.1465 | 0.0100 | 0.072 | ece_0.1465_gt_0.04 |
| nfl:v0.3.2:player_prop:any_td:main | **FAIL** | 1644 | 285 | 283.3 | 0.2394 | 0.6808 | 0.1465 | 0.0097 | 0.072 | ece_0.1465_gt_0.04 |
| nfl:v0.3.2:closing_line_benchmark | **INSUFFICIENT_DATA** | 0 | 0 | 0.0 | n/a | n/a | n/a | n/a | 0.000 | closing_line_unavailable_unlicensed; oos_sample_0_lt_500; ece_null_gt_0.04 |

### Dist compare

| Dist | n | actMean | simMean | err | actVar | simVar | varRatio | actP90 | simP90 |
|------|---|---------|---------|-----|--------|--------|----------|--------|--------|
| nfl:pass_yds | 570 | 228.03 | 221.86 | -6.17 | 5164.64 | 542.63 | 0.11 | 323.0 | 252.6 |
| nfl:any_td | 1644 | 0.97 | 0.67 | -0.30 | 1.11 | 0.06 | 0.05 | 2.0 | 0.9 |
| nfl:rush_yds | 570 | 72.58 | 67.92 | -4.66 | 1309.15 | 69.19 | 0.05 | 119.0 | 77.9 |
| nfl:rec_yds | 570 | 86.25 | 87.02 | 0.77 | 1035.41 | 307.48 | 0.30 | 125.0 | 113.1 |

### Reliability

| bin | n | avgPred | avgY | gap |
|-----|---|---------|------|-----|
| 0.0-0.1 | 1630 | 0.044 | 0.104 | -0.059 |
| 0.1-0.2 | 986 | 0.143 | 0.167 | -0.024 |
| 0.2-0.3 | 636 | 0.251 | 0.283 | -0.032 |
| 0.3-0.4 | 792 | 0.348 | 0.431 | -0.083 |
| 0.4-0.5 | 612 | 0.447 | 0.487 | -0.040 |
| 0.5-0.6 | 453 | 0.549 | 0.521 | 0.028 |
| 0.6-0.7 | 425 | 0.650 | 0.569 | 0.081 |
| 0.7-0.8 | 636 | 0.752 | 0.580 | 0.172 |
| 0.8-0.9 | 1067 | 0.861 | 0.783 | 0.078 |
| 0.9-1.0 | 1243 | 0.919 | 0.898 | 0.021 |

# NCAAF

- Holdout label: NCAAF 2024 weeks 8–15
- Holdout games (identical for A/B): 404
- Games with named leaders: v0.2=404 / v0.3.2=404
- Distinct named athletes: v0.2=879 / v0.3.2=879
- Rejected proxy/missing identity (not graded): v0.2=0 / v0.3.2=0
- Settled obs (paired): 11989 (dropped unpaired v0.2=4 v0.3.2=0)
- Runtime p95 ms/game: v0.2=17.0 / v0.3.2=18.1
- Proxy players graded: **none** (asserted)

## Before/after by family (v0.2 → v0.3.2)

| Family | v0.2 (prior) | v0.3.2 (calibrated) | MAD½ v0.2 | MAD½ v0.3.2 | shrink-to-50 |
|--------|--------------|---------------------|-----------|-------------|--------------|
| ncaaf:closing_line_benchmark | **INSUFFICIENT_DATA** n=0 Brier=n/a LL=n/a ECE=n/a SE=n/a | **INSUFFICIENT_DATA** n=0 Brier=n/a LL=n/a ECE=n/a SE=n/a | 0.000 | 0.000 | no_observations |
| ncaaf:player_prop | **FAIL** n=11989 Brier=0.2846 LL=0.8294 ECE=0.2725 SE=0.0069 | **FAIL** n=11989 Brier=0.1889 LL=0.5676 ECE=0.0722 SE=0.0054 | 0.301 | 0.286 | ok_dispersion |
| ncaaf:player_prop:any_td | **FAIL** n=2301 Brier=0.2176 LL=0.6347 ECE=0.1182 SE=0.0084 | **FAIL** n=2301 Brier=0.2175 LL=0.6341 ECE=0.1162 SE=0.0079 | 0.274 | 0.274 | ok_dispersion |
| ncaaf:player_prop:any_td:main | **FAIL** n=2301 Brier=0.2176 LL=0.6347 ECE=0.1182 SE=0.0080 | **FAIL** n=2301 Brier=0.2175 LL=0.6341 ECE=0.1162 SE=0.0080 | 0.274 | 0.274 | ok_dispersion |
| ncaaf:player_prop:pass_yds | **FAIL** n=3232 Brier=0.3748 LL=1.0863 ECE=0.4551 SE=0.0110 | **FAIL** n=3232 Brier=0.1760 LL=0.5231 ECE=0.1188 SE=0.0105 | 0.279 | 0.244 | ok_dispersion |
| ncaaf:player_prop:pass_yds:alt | **FAIL** n=2424 Brier=0.3432 LL=1.0012 ECE=0.4407 SE=0.0092 | **FAIL** n=2424 Brier=0.1529 LL=0.4690 ECE=0.1142 SE=0.0097 | 0.254 | 0.283 | ok_dispersion |
| ncaaf:player_prop:pass_yds:main | **FAIL** n=808 Brier=0.4698 LL=1.3418 ECE=0.4982 SE=0.0169 | **FAIL** n=808 Brier=0.2456 LL=0.6852 ECE=0.1327 SE=0.0170 | 0.353 | 0.127 | ok_dispersion |
| ncaaf:player_prop:rec_yds | **FAIL** n=3228 Brier=0.2831 LL=0.8199 ECE=0.2808 SE=0.0103 | **FAIL** n=3228 Brier=0.1794 LL=0.5398 ECE=0.0875 SE=0.0091 | 0.345 | 0.297 | ok_dispersion |
| ncaaf:player_prop:rec_yds:alt | **FAIL** n=2421 Brier=0.3012 LL=0.8518 ECE=0.3130 SE=0.0107 | **FAIL** n=2421 Brier=0.1720 LL=0.5150 ECE=0.0921 SE=0.0084 | 0.320 | 0.283 | ok_dispersion |
| ncaaf:player_prop:rec_yds:main | **FAIL** n=807 Brier=0.2286 LL=0.7244 ECE=0.1842 SE=0.0146 | **FAIL** n=807 Brier=0.2019 LL=0.6140 ECE=0.1047 SE=0.0161 | 0.418 | 0.338 | ok_dispersion |
| ncaaf:player_prop:rush_yds | **FAIL** n=3228 Brier=0.2435 LL=0.7205 ECE=0.2239 SE=0.0103 | **FAIL** n=3228 Brier=0.1908 LL=0.5927 ECE=0.1063 SE=0.0079 | 0.300 | 0.325 | ok_dispersion |
| ncaaf:player_prop:rush_yds:alt | **FAIL** n=2420 Brier=0.2099 LL=0.6153 ECE=0.1927 SE=0.0101 | **FAIL** n=2420 Brier=0.1688 LL=0.5529 ECE=0.1050 SE=0.0083 | 0.272 | 0.390 | over_sharp_vs_50 |
| ncaaf:player_prop:rush_yds:main | **FAIL** n=808 Brier=0.3442 LL=1.0356 ECE=0.3171 SE=0.0142 | **FAIL** n=808 Brier=0.2568 LL=0.7119 ECE=0.1165 SE=0.0154 | 0.384 | 0.128 | ok_dispersion |

## NCAAF profile v0.2 (model 0.2.0)

- n=11989 games=404 effN≈ named athletes 879
- Brier=0.2846 LogLoss=0.8294 ECE=0.2725 bias=0.272
- meanAbsDevFromHalf=0.301 fracNearHalf(|p−0.5|≤0.05)=0.068 fracExtreme(p≤0.1|p≥0.9)=0.398 → **ok_dispersion**
- overconf80 hit=0.650 (n=6946); overconf90=0.733 (n=4730); overconf95=0.684 (n=731)
- runtime: total=6.5s mean=16.2ms/game p95=17.0ms

### Family gates

| Family | Verdict | n | games | effN | Brier | LogLoss | ECE | ECE_SE | bias | reasons |
|--------|---------|---|-------|------|-------|---------|-----|--------|------|---------|
| ncaaf:v0.2:player_prop | **FAIL** | 11989 | 404 | 403.8 | 0.2846 | 0.8294 | 0.2725 | 0.0069 | 0.272 | ece_0.2725_gt_0.04; overconfident_p90_hit_0.733_n_4730; overconfident_p95_hit_0.684_n_731 |
| ncaaf:v0.2:player_prop:pass_yds | **FAIL** | 3232 | 404 | 404.0 | 0.3748 | 1.0863 | 0.4551 | 0.0110 | 0.455 | ece_0.4551_gt_0.04; overconfident_p90_hit_0.523_n_1016; overconfident_p95_hit_0.602_n_399 |
| ncaaf:v0.2:player_prop:pass_yds:main | **FAIL** | 808 | 404 | 404.0 | 0.4698 | 1.3418 | 0.4982 | 0.0169 | 0.498 | ece_0.4982_gt_0.04; overconfident_p90_hit_0.447_n_304; overconfident_p95_hit_0.424_n_33 |
| ncaaf:v0.2:player_prop:pass_yds:alt | **FAIL** | 2424 | 404 | 404.0 | 0.3432 | 1.0012 | 0.4407 | 0.0092 | 0.441 | ece_0.4407_gt_0.04; overconfident_p90_hit_0.555_n_712; overconfident_p95_hit_0.617_n_366 |
| ncaaf:v0.2:player_prop:rush_yds | **FAIL** | 3228 | 404 | 403.9 | 0.2435 | 0.7205 | 0.2239 | 0.0103 | 0.224 | ece_0.2239_gt_0.04; overconfident_p90_hit_0.792_n_1150; overconfident_p95_hit_0.683_n_186 |
| ncaaf:v0.2:player_prop:rush_yds:main | **FAIL** | 808 | 404 | 404.0 | 0.3442 | 1.0356 | 0.3171 | 0.0142 | 0.317 | ece_0.3171_gt_0.04; overconfident_p90_hit_0.616_n_294; overconfident_p95_hit_0.443_n_88 |
| ncaaf:v0.2:player_prop:rush_yds:alt | **FAIL** | 2420 | 404 | 403.9 | 0.2099 | 0.6153 | 0.1927 | 0.0101 | 0.193 | ece_0.1927_gt_0.04 |
| ncaaf:v0.2:player_prop:rec_yds | **FAIL** | 3228 | 404 | 403.8 | 0.2831 | 0.8199 | 0.2808 | 0.0103 | 0.281 | ece_0.2808_gt_0.04; overconfident_p90_hit_0.767_n_1885 |
| ncaaf:v0.2:player_prop:rec_yds:main | **FAIL** | 807 | 404 | 403.8 | 0.2286 | 0.7244 | 0.1842 | 0.0146 | 0.184 | ece_0.1842_gt_0.04; overconfident_p90_hit_0.742_n_798 |
| ncaaf:v0.2:player_prop:rec_yds:alt | **FAIL** | 2421 | 404 | 403.8 | 0.3012 | 0.8518 | 0.3130 | 0.0107 | 0.313 | ece_0.3130_gt_0.04; overconfident_p90_hit_0.785_n_1087 |
| ncaaf:v0.2:player_prop:any_td | **FAIL** | 2301 | 404 | 400.6 | 0.2176 | 0.6347 | 0.1182 | 0.0084 | 0.073 | ece_0.1182_gt_0.04 |
| ncaaf:v0.2:player_prop:any_td:main | **FAIL** | 2301 | 404 | 400.6 | 0.2176 | 0.6347 | 0.1182 | 0.0080 | 0.073 | ece_0.1182_gt_0.04 |
| ncaaf:v0.2:closing_line_benchmark | **INSUFFICIENT_DATA** | 0 | 0 | 0.0 | n/a | n/a | n/a | n/a | 0.000 | closing_line_unavailable_unlicensed; oos_sample_0_lt_500; ece_null_gt_0.04 |

### Dist compare

| Dist | n | actMean | simMean | err | actVar | simVar | varRatio | actP90 | simP90 |
|------|---|---------|---------|-----|--------|--------|----------|--------|--------|
| ncaaf:pass_yds | 808 | 209.14 | 349.36 | 140.23 | 7281.83 | 2206.57 | 0.30 | 319.0 | 412.1 |
| ncaaf:any_td | 2301 | 1.14 | 0.71 | -0.43 | 1.39 | 0.05 | 0.04 | 3.0 | 0.9 |
| ncaaf:rush_yds | 808 | 88.91 | 117.04 | 28.13 | 1936.75 | 315.84 | 0.16 | 147.0 | 140.9 |
| ncaaf:rec_yds | 807 | 83.80 | 148.18 | 64.39 | 1340.41 | 1250.65 | 0.93 | 131.0 | 205.6 |

### Reliability

| bin | n | avgPred | avgY | gap |
|-----|---|---------|------|-----|
| 0.0-0.1 | 45 | 0.072 | 0.044 | 0.028 |
| 0.1-0.2 | 160 | 0.157 | 0.050 | 0.107 |
| 0.2-0.3 | 374 | 0.255 | 0.091 | 0.164 |
| 0.3-0.4 | 708 | 0.354 | 0.250 | 0.104 |
| 0.4-0.5 | 844 | 0.449 | 0.270 | 0.179 |
| 0.5-0.6 | 767 | 0.548 | 0.207 | 0.341 |
| 0.6-0.7 | 899 | 0.652 | 0.220 | 0.432 |
| 0.7-0.8 | 1246 | 0.754 | 0.318 | 0.436 |
| 0.8-0.9 | 2216 | 0.856 | 0.473 | 0.383 |
| 0.9-1.0 | 4730 | 0.927 | 0.733 | 0.194 |

## NCAAF profile v0.3.2 (model 0.3.2)

- n=11989 games=404 effN≈ named athletes 879
- Brier=0.1889 LogLoss=0.5676 ECE=0.0722 bias=0.048
- meanAbsDevFromHalf=0.286 fracNearHalf(|p−0.5|≤0.05)=0.080 fracExtreme(p≤0.1|p≥0.9)=0.312 → **ok_dispersion**
- overconf80 hit=0.816 (n=3760); overconf90=0.885 (n=2265); overconf95=0.908 (n=229)
- runtime: total=6.8s mean=16.9ms/game p95=18.1ms

### Family gates

| Family | Verdict | n | games | effN | Brier | LogLoss | ECE | ECE_SE | bias | reasons |
|--------|---------|---|-------|------|-------|---------|-----|--------|------|---------|
| ncaaf:v0.3.2:player_prop | **FAIL** | 11989 | 404 | 403.8 | 0.1889 | 0.5676 | 0.0722 | 0.0054 | 0.048 | ece_0.0722_gt_0.04 |
| ncaaf:v0.3.2:player_prop:pass_yds | **FAIL** | 3232 | 404 | 404.0 | 0.1760 | 0.5231 | 0.1188 | 0.0105 | 0.119 | ece_0.1188_gt_0.04 |
| ncaaf:v0.3.2:player_prop:pass_yds:main | **FAIL** | 808 | 404 | 404.0 | 0.2456 | 0.6852 | 0.1327 | 0.0170 | 0.133 | ece_0.1327_gt_0.04 |
| ncaaf:v0.3.2:player_prop:pass_yds:alt | **FAIL** | 2424 | 404 | 404.0 | 0.1529 | 0.4690 | 0.1142 | 0.0097 | 0.114 | ece_0.1142_gt_0.04 |
| ncaaf:v0.3.2:player_prop:rush_yds | **FAIL** | 3228 | 404 | 403.9 | 0.1908 | 0.5927 | 0.1063 | 0.0079 | -0.079 | ece_0.1063_gt_0.04 |
| ncaaf:v0.3.2:player_prop:rush_yds:main | **FAIL** | 808 | 404 | 404.0 | 0.2568 | 0.7119 | 0.1165 | 0.0154 | -0.067 | ece_0.1165_gt_0.04 |
| ncaaf:v0.3.2:player_prop:rush_yds:alt | **FAIL** | 2420 | 404 | 403.9 | 0.1688 | 0.5529 | 0.1050 | 0.0083 | -0.083 | ece_0.1050_gt_0.04 |
| ncaaf:v0.3.2:player_prop:rec_yds | **FAIL** | 3228 | 404 | 403.8 | 0.1794 | 0.5398 | 0.0875 | 0.0091 | 0.087 | ece_0.0875_gt_0.04 |
| ncaaf:v0.3.2:player_prop:rec_yds:main | **FAIL** | 807 | 404 | 403.8 | 0.2019 | 0.6140 | 0.1047 | 0.0161 | 0.105 | ece_0.1047_gt_0.04; overconfident_p90_hit_0.682_n_148 |
| ncaaf:v0.3.2:player_prop:rec_yds:alt | **FAIL** | 2421 | 404 | 403.8 | 0.1720 | 0.5150 | 0.0921 | 0.0084 | 0.082 | ece_0.0921_gt_0.04 |
| ncaaf:v0.3.2:player_prop:any_td | **FAIL** | 2301 | 404 | 400.6 | 0.2175 | 0.6341 | 0.1162 | 0.0079 | 0.072 | ece_0.1162_gt_0.04 |
| ncaaf:v0.3.2:player_prop:any_td:main | **FAIL** | 2301 | 404 | 400.6 | 0.2175 | 0.6341 | 0.1162 | 0.0080 | 0.072 | ece_0.1162_gt_0.04 |
| ncaaf:v0.3.2:closing_line_benchmark | **INSUFFICIENT_DATA** | 0 | 0 | 0.0 | n/a | n/a | n/a | n/a | 0.000 | closing_line_unavailable_unlicensed; oos_sample_0_lt_500; ece_null_gt_0.04 |

### Dist compare

| Dist | n | actMean | simMean | err | actVar | simVar | varRatio | actP90 | simP90 |
|------|---|---------|---------|-----|--------|--------|----------|--------|--------|
| ncaaf:pass_yds | 808 | 209.14 | 246.25 | 37.11 | 7281.83 | 1027.38 | 0.14 | 319.0 | 288.6 |
| ncaaf:any_td | 2301 | 1.14 | 0.71 | -0.43 | 1.39 | 0.05 | 0.04 | 3.0 | 0.9 |
| ncaaf:rush_yds | 808 | 88.91 | 75.10 | -13.80 | 1936.75 | 125.63 | 0.06 | 147.0 | 89.7 |
| ncaaf:rec_yds | 807 | 83.80 | 98.66 | 14.86 | 1340.41 | 551.65 | 0.41 | 131.0 | 135.9 |

### Reliability

| bin | n | avgPred | avgY | gap |
|-----|---|---------|------|-----|
| 0.0-0.1 | 1474 | 0.047 | 0.119 | -0.073 |
| 0.1-0.2 | 1243 | 0.148 | 0.178 | -0.030 |
| 0.2-0.3 | 989 | 0.249 | 0.242 | 0.007 |
| 0.3-0.4 | 1042 | 0.351 | 0.339 | 0.012 |
| 0.4-0.5 | 1045 | 0.449 | 0.439 | 0.009 |
| 0.5-0.6 | 849 | 0.546 | 0.468 | 0.078 |
| 0.6-0.7 | 668 | 0.651 | 0.475 | 0.176 |
| 0.7-0.8 | 919 | 0.754 | 0.528 | 0.227 |
| 0.8-0.9 | 1495 | 0.854 | 0.712 | 0.142 |
| 0.9-1.0 | 2265 | 0.924 | 0.885 | 0.038 |

## Blockers / notes

- Closing-line rows remain INSUFFICIENT (unlicensed archive).
- Identity gate: only `/^\d{3,}$/` ESPN athlete ids; `home_qb`-style proxies never enter obs.
- `any_td` graded only when boxscore TD columns parse for that named athlete.
