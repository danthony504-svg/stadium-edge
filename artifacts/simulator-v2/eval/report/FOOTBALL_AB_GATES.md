# Football A/B family gates (holdout)

Thresholds: minOos=500, maxEce=0.04. Verdicts: **PASS** | **FAIL** | **INSUFFICIENT_DATA**.

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

## A/B summary (non-CL families)

| Sport | Family | v0.2 | v0.3.2 | ΔECE | MAD½ 0.2 | MAD½ 0.3.2 |
|-------|--------|------|--------|------|----------|------------|
| nfl | player_prop | **FAIL** ECE=0.2235 | **FAIL** ECE=0.0587 | -0.1648 | 0.283 | 0.302 |
| nfl | player_prop:any_td | **FAIL** ECE=0.1459 | **FAIL** ECE=0.1465 | 0.0006 | 0.268 | 0.268 |
| nfl | player_prop:any_td:main | **FAIL** ECE=0.1459 | **FAIL** ECE=0.1465 | 0.0006 | 0.268 | 0.268 |
| nfl | player_prop:pass_yds | **FAIL** ECE=0.3204 | **PASS** ECE=0.0251 | -0.2953 | 0.238 | 0.275 |
| nfl | player_prop:pass_yds:alt | **FAIL** ECE=0.3011 | **PASS** ECE=0.0320 | -0.2690 | 0.235 | 0.304 |
| nfl | player_prop:pass_yds:main | **FAIL** ECE=0.3834 | **FAIL** ECE=0.0668 | -0.3167 | 0.245 | 0.189 |
| nfl | player_prop:rec_yds | **FAIL** ECE=0.2029 | **FAIL** ECE=0.0444 | -0.1585 | 0.319 | 0.313 |
| nfl | player_prop:rec_yds:alt | **FAIL** ECE=0.2496 | **FAIL** ECE=0.0747 | -0.1750 | 0.285 | 0.305 |
| nfl | player_prop:rec_yds:main | **FAIL** ECE=0.0628 | **FAIL** ECE=0.0464 | -0.0164 | 0.419 | 0.335 |
| nfl | player_prop:rush_yds | **FAIL** ECE=0.2569 | **FAIL** ECE=0.0812 | -0.1757 | 0.304 | 0.342 |
| nfl | player_prop:rush_yds:alt | **FAIL** ECE=0.2196 | **FAIL** ECE=0.0840 | -0.1356 | 0.271 | 0.419 |
| nfl | player_prop:rush_yds:main | **FAIL** ECE=0.3687 | **FAIL** ECE=0.0979 | -0.2708 | 0.402 | 0.110 |
| ncaaf | player_prop | **FAIL** ECE=0.2725 | **FAIL** ECE=0.0722 | -0.2002 | 0.301 | 0.286 |
| ncaaf | player_prop:any_td | **FAIL** ECE=0.1182 | **FAIL** ECE=0.1162 | -0.0020 | 0.274 | 0.274 |
| ncaaf | player_prop:any_td:main | **FAIL** ECE=0.1182 | **FAIL** ECE=0.1162 | -0.0020 | 0.274 | 0.274 |
| ncaaf | player_prop:pass_yds | **FAIL** ECE=0.4551 | **FAIL** ECE=0.1188 | -0.3362 | 0.279 | 0.244 |
| ncaaf | player_prop:pass_yds:alt | **FAIL** ECE=0.4407 | **FAIL** ECE=0.1142 | -0.3265 | 0.254 | 0.283 |
| ncaaf | player_prop:pass_yds:main | **FAIL** ECE=0.4982 | **FAIL** ECE=0.1327 | -0.3655 | 0.353 | 0.127 |
| ncaaf | player_prop:rec_yds | **FAIL** ECE=0.2808 | **FAIL** ECE=0.0875 | -0.1933 | 0.345 | 0.297 |
| ncaaf | player_prop:rec_yds:alt | **FAIL** ECE=0.3130 | **FAIL** ECE=0.0921 | -0.2209 | 0.320 | 0.283 |
| ncaaf | player_prop:rec_yds:main | **FAIL** ECE=0.1842 | **FAIL** ECE=0.1047 | -0.0794 | 0.418 | 0.338 |
| ncaaf | player_prop:rush_yds | **FAIL** ECE=0.2239 | **FAIL** ECE=0.1063 | -0.1176 | 0.300 | 0.325 |
| ncaaf | player_prop:rush_yds:alt | **FAIL** ECE=0.1927 | **FAIL** ECE=0.1050 | -0.0877 | 0.272 | 0.390 |
| ncaaf | player_prop:rush_yds:main | **FAIL** ECE=0.3171 | **FAIL** ECE=0.1165 | -0.2006 | 0.384 | 0.128 |

## Totals

- PASS=2 FAIL=46 INSUFFICIENT_DATA=4
- Proxy / missing-identity players graded: **0** (hard reject).
- Production allowlist unchanged; serve remains off.
