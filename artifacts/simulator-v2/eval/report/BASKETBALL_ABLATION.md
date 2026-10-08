# Basketball one-factor ablations + restored v0.2 holdout

Decision: **REVERT** blanket v0.3. Default levers = v0.2. Ablations are eval-only.

## NBA
- Games: 1234; val n_games≤120; holdout n_games≤309
- Default model version restored: **0.2.0**

### Val ablations (diagnostic — factor selection)
| Profile | main n | ECE | Brier | LogLoss | vs v0.2 ΔECE |
|---------|--------|-----|-------|---------|--------------|
| v0.2 | 360 | 0.0919 | 0.2301 | 0.6528 | 0.0000 |
| ablate_shrink | 360 | 0.0868 | 0.2306 | 0.6536 | -0.0051 |
| ablate_shock | 360 | 0.0931 | 0.2345 | 0.6617 | 0.0012 |
| ablate_hfa | 360 | 0.1098 | 0.2317 | 0.6560 | 0.0179 |
| v0.3 | 360 | 0.1118 | 0.2370 | 0.6667 | 0.0199 |

### Holdout gates — restored v0.2 default
- Thresholds: minOos=500, maxEce=0.04
- Integrity/latency/shadow soak not re-claimed here; this gate is calibration-only (ECE/n/Brier/LL).
| Family | Verdict | n | games | effN | Brier | LogLoss | ECE | ECE_SE | bias | reasons |
|--------|---------|---|-------|------|-------|---------|-----|--------|------|---------|
| nba:main_all:v0.2 | **FAIL** | 927 | 309 | 309.0 | 0.2270 | 0.6479 | 0.0517 | 0.0143 | -0.043 | ece_0.0517_gt_0.04 |
| nba:ml:v0.2 | **INSUFFICIENT_DATA** | 309 | 309 | 309.0 | 0.2150 | 0.6203 | 0.0643 | 0.0198 | -0.002 | oos_sample_309_lt_500; ece_0.0643_gt_0.04 |
| nba:spread:v0.2 | **INSUFFICIENT_DATA** | 309 | 309 | 309.0 | 0.2325 | 0.6580 | 0.1768 | 0.0230 | -0.177 | oos_sample_309_lt_500; ece_0.1768_gt_0.04 |
| nba:total:v0.2 | **INSUFFICIENT_DATA** | 309 | 309 | 309.0 | 0.2334 | 0.6654 | 0.0610 | 0.0194 | 0.051 | oos_sample_309_lt_500; ece_0.0610_gt_0.04 |

## WNBA
- Games: 709; val n_games≤120; holdout n_games≤178
- Default model version restored: **0.2.0**

### Val ablations (diagnostic — factor selection)
| Profile | main n | ECE | Brier | LogLoss | vs v0.2 ΔECE |
|---------|--------|-----|-------|---------|--------------|
| v0.2 | 357 | 0.0457 | 0.2328 | 0.6607 | 0.0000 |
| ablate_shrink | 357 | 0.0472 | 0.2334 | 0.6609 | 0.0015 |
| ablate_shock | 357 | 0.0668 | 0.2334 | 0.6601 | 0.0211 |
| ablate_hfa | 357 | 0.0651 | 0.2333 | 0.6617 | 0.0194 |
| v0.3 | 357 | 0.0581 | 0.2367 | 0.6662 | 0.0124 |

### Holdout gates — restored v0.2 default
- Thresholds: minOos=500, maxEce=0.04
- Integrity/latency/shadow soak not re-claimed here; this gate is calibration-only (ECE/n/Brier/LL).
| Family | Verdict | n | games | effN | Brier | LogLoss | ECE | ECE_SE | bias | reasons |
|--------|---------|---|-------|------|-------|---------|-----|--------|------|---------|
| wnba:main_all:v0.2 | **FAIL** | 531 | 177 | 177.0 | 0.2251 | 0.6418 | 0.0595 | 0.0170 | -0.013 | ece_0.0595_gt_0.04 |
| wnba:ml:v0.2 | **INSUFFICIENT_DATA** | 177 | 177 | 177.0 | 0.2164 | 0.6231 | 0.1412 | 0.0305 | 0.011 | oos_sample_177_lt_500; ece_0.1412_gt_0.04 |
| wnba:spread:v0.2 | **INSUFFICIENT_DATA** | 177 | 177 | 177.0 | 0.2328 | 0.6599 | 0.1340 | 0.0301 | -0.134 | oos_sample_177_lt_500; ece_0.1340_gt_0.04 |
| wnba:total:v0.2 | **INSUFFICIENT_DATA** | 177 | 177 | 177.0 | 0.2262 | 0.6425 | 0.0951 | 0.0289 | 0.084 | oos_sample_177_lt_500; ece_0.0951_gt_0.04 |

## NCAAB
- Games: 7393; val n_games≤120; holdout n_games≤400
- Default model version restored: **0.2.0**

### Val ablations (diagnostic — factor selection)
| Profile | main n | ECE | Brier | LogLoss | vs v0.2 ΔECE |
|---------|--------|-----|-------|---------|--------------|
| v0.2 | 318 | 0.1145 | 0.2344 | 0.6670 | 0.0000 |
| ablate_shrink | 318 | 0.0915 | 0.2324 | 0.6595 | -0.0230 |
| ablate_shock | 318 | 0.0971 | 0.2333 | 0.6606 | -0.0174 |
| ablate_hfa | 318 | 0.1315 | 0.2365 | 0.6715 | 0.0169 |
| v0.3 | 318 | 0.1093 | 0.2361 | 0.6653 | -0.0052 |

### Holdout gates — restored v0.2 default
- Thresholds: minOos=500, maxEce=0.04
- Integrity/latency/shadow soak not re-claimed here; this gate is calibration-only (ECE/n/Brier/LL).
| Family | Verdict | n | games | effN | Brier | LogLoss | ECE | ECE_SE | bias | reasons |
|--------|---------|---|-------|------|-------|---------|-----|--------|------|---------|
| ncaab:main_all:v0.2 | **FAIL** | 1188 | 396 | 396.0 | 0.2221 | 0.6330 | 0.0474 | 0.0145 | -0.042 | ece_0.0474_gt_0.04 |
| ncaab:ml:v0.2 | **INSUFFICIENT_DATA** | 396 | 396 | 396.0 | 0.2123 | 0.6108 | 0.0414 | 0.0167 | -0.026 | oos_sample_396_lt_500; ece_0.0414_gt_0.04 |
| ncaab:spread:v0.2 | **INSUFFICIENT_DATA** | 396 | 396 | 396.0 | 0.2310 | 0.6522 | 0.1943 | 0.0218 | -0.194 | oos_sample_396_lt_500; ece_0.1943_gt_0.04 |
| ncaab:total:v0.2 | **INSUFFICIENT_DATA** | 396 | 396 | 396.0 | 0.2231 | 0.6361 | 0.0941 | 0.0203 | 0.094 | oos_sample_396_lt_500; ece_0.0941_gt_0.04 |

## Notes
- Prior A/B: ncaab:main_all v0.2 ECE 0.0396 **PASS** (n=1584≥500); v0.3 failed.
- That PASS was ECE+n only in familyCalibration; full serve acceptance still requires soak/latency/contracts.
- Serve/allowlists unchanged.