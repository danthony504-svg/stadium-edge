# Simulator V2 Phase B — Calibration Root-Cause Audit (READ-ONLY)

Generated: 2026-10-08T18:54:25.002Z

## Scope

- **No model changes.** No gate flips. No Coach/P0/OTA/PR#649 actions.
- Uses existing walk-forward observations + ESPN cache from historical validation.
- Does **not** fit or tune calibration on a held-out final set; recommendations are directional only.
- Game-clustered bootstrap SEs account for dependence across markets within a game.

## NFL

### Reliability by probability bucket (V2, all eval markets)

| Bucket | n | Pred p̄ | Outcome ȳ | Error (p̄−ȳ) |
|--------|---|---------|-----------|-------------|
| [0.0,0.1] | 2969 | 0.0424 | 0.1775 | -0.1351 |
| [0.1,0.2] | 2265 | 0.1485 | 0.2887 | -0.1402 |
| [0.2,0.3] | 2185 | 0.2502 | 0.3597 | -0.1095 |
| [0.3,0.4] | 2113 | 0.3496 | 0.4250 | -0.0754 |
| [0.4,0.5] | 2065 | 0.4494 | 0.4678 | -0.0184 |
| [0.5,0.6] | 2034 | 0.5502 | 0.5334 | 0.0168 |
| [0.6,0.7] | 1933 | 0.6498 | 0.5784 | 0.0715 |
| [0.7,0.8] | 1846 | 0.7481 | 0.6213 | 0.1268 |
| [0.8,0.9] | 1505 | 0.8478 | 0.6977 | 0.1501 |
| [0.9,1.0] | 835 | 0.9406 | 0.7593 | 0.1813 |

### Reliability by probability bucket (V1, all eval markets)

| Bucket | n | Pred p̄ | Outcome ȳ | Error (p̄−ȳ) |
|--------|---|---------|-----------|-------------|
| [0.0,0.1] | 2099 | 0.0439 | 0.1644 | -0.1204 |
| [0.1,0.2] | 2016 | 0.1491 | 0.2406 | -0.0914 |
| [0.2,0.3] | 2267 | 0.2516 | 0.3233 | -0.0718 |
| [0.3,0.4] | 2440 | 0.3501 | 0.3889 | -0.0388 |
| [0.4,0.5] | 2512 | 0.4502 | 0.4642 | -0.0139 |
| [0.5,0.6] | 2560 | 0.5496 | 0.5391 | 0.0105 |
| [0.6,0.7] | 2150 | 0.6473 | 0.6112 | 0.0362 |
| [0.7,0.8] | 1656 | 0.7461 | 0.6383 | 0.1078 |
| [0.8,0.9] | 1180 | 0.8466 | 0.6822 | 0.1644 |
| [0.9,1.0] | 870 | 0.9503 | 0.7253 | 0.2250 |

### Reliability — FG moneyline home (V2)

| Bucket | n | Pred p̄ | Outcome ȳ | Error (p̄−ȳ) |
|--------|---|---------|-----------|-------------|
| [0.0,0.1] | 26 | 0.0705 | 0.4231 | -0.3526 |
| [0.1,0.2] | 63 | 0.1545 | 0.3810 | -0.2265 |
| [0.2,0.3] | 97 | 0.2533 | 0.4330 | -0.1797 |
| [0.3,0.4] | 116 | 0.3536 | 0.5603 | -0.2068 |
| [0.4,0.5] | 121 | 0.4491 | 0.4545 | -0.0055 |
| [0.5,0.6] | 141 | 0.5486 | 0.5887 | -0.0400 |
| [0.6,0.7] | 102 | 0.6501 | 0.6667 | -0.0166 |
| [0.7,0.8] | 64 | 0.7464 | 0.7500 | -0.0036 |
| [0.8,0.9] | 42 | 0.8438 | 0.7857 | 0.0581 |
| [0.9,1.0] | 18 | 0.9481 | 0.8333 | 0.1147 |

### Calibration slices (V2)

| Slice | n | Brier | Log loss | ECE | bias | p̄ | ȳ |
|-------|---|-------|----------|-----|------|----|---|
| FG ML favorite (p>0.5) | 364 | 0.2151 | 0.6252 | 0.0291 | -0.0043 | 0.6660 | 0.6703 |
| FG ML underdog (p≤0.5) | 426 | 0.2792 | 0.7805 | 0.1573 | -0.1573 | 0.3122 | 0.4695 |
| Team total HOME overs (FG) | 3160 | 0.2285 | 0.6678 | 0.0859 | -0.0390 | 0.4679 | 0.5070 |
| Team total AWAY overs (FG) | 3160 | 0.2316 | 0.6717 | 0.1097 | 0.0652 | 0.4728 | 0.4076 |
| Main spreads (|line|≤7.5) | 2370 | 0.2215 | 0.6501 | 0.0839 | -0.0685 | 0.4054 | 0.4738 |
| Alt spreads (7.5<|line|<14) | 790 | 0.1850 | 0.5986 | 0.1071 | -0.0956 | 0.1475 | 0.2430 |
| Extreme spreads (|line|≥14) | 1580 | 0.1494 | 0.6458 | 0.1177 | -0.1088 | 0.0615 | 0.1703 |
| Low totals (line<44.5) | 1580 | 0.2452 | 0.7026 | 0.1022 | 0.0432 | 0.6678 | 0.6247 |
| High totals (line≥44.5) | 2370 | 0.2349 | 0.6725 | 0.0938 | 0.0111 | 0.3693 | 0.3582 |
| Period=fg | 15800 | 0.2217 | 0.6665 | 0.0860 | -0.0191 | 0.4084 | 0.4275 |
| Period=h1 | 2370 | 0.2687 | 0.7613 | 0.1468 | -0.0332 | 0.4601 | 0.4932 |
| Period=q2 | 1580 | 0.2589 | 0.7644 | 0.1494 | 0.0051 | 0.6013 | 0.5962 |
| V2 p≥0.8 | 2340 | 0.2271 | 0.7086 | 0.1612 | 0.1612 | 0.8809 | 0.7197 |
| V2 p≤0.20 | 5234 | 0.1891 | 0.6589 | 0.1373 | -0.1373 | 0.0884 | 0.2256 |
| V2 p≥0.9 | 835 | 0.2146 | 0.7425 | 0.1813 | 0.1813 | 0.9406 | 0.7593 |
| V2 p≤0.10 | 2969 | 0.1620 | 0.6531 | 0.1351 | -0.1351 | 0.0424 | 0.1775 |
| V2 p≥0.95 | 300 | 0.2095 | 0.8129 | 0.1944 | 0.1944 | 0.9710 | 0.7767 |
| V2 p≤0.05 | 1804 | 0.1371 | 0.6525 | 0.1219 | -0.1219 | 0.0216 | 0.1436 |

### Game-clustered uncertainty (bootstrap SE over eventId)

| Scope | n rows | Brier | Brier SE | ECE | ECE SE | n games |
|-------|--------|-------|----------|-----|--------|---------|
| All markets | 19750 | 0.2303 | 0.0036 | 0.0982 | 0.0055 | 790 |
| FG ML | 790 | 0.2497 | 0.0074 | 0.0982 | 0.0143 | 790 |
| FG spreads | 4740 | 0.1914 | 0.0071 | 0.0961 | 0.0102 | 790 |
| FG totals | 3950 | 0.2390 | 0.0051 | 0.0857 | 0.0096 | 790 |
| Extreme spreads | 1580 | 0.1494 | 0.0110 | 0.1177 | 0.0126 | 790 |

### Baseline comparison — FG moneyline home (identical games)

| Engine | n | Brier | Log loss | ECE | bias | p̄ | ȳ |
|--------|---|-------|----------|-----|------|----|---|
| V2 joint | 790 | 0.2497 | 0.7090 | 0.0982 | -0.0868 | 0.4752 | 0.5620 |
| V1 frac | 790 | 0.2394 | 0.6784 | 0.0713 | -0.0670 | 0.4950 | 0.5620 |
| Hist frequency | 790 | 0.2487 | 0.7138 | 0.0108 | -0.0041 | 0.5579 | 0.5620 |
| Coin 0.5 | 790 | 0.2500 | 0.6931 | 0.0620 | -0.0620 | 0.5000 | 0.5620 |
| Team-strength logistic | 790 | 0.2623 | 0.7634 | 0.1374 | -0.0681 | 0.4939 | 0.5620 |
| Market-implied closing | 0 | n/a | n/a | n/a | 0.0000 | 0.0000 | 0.0000 |

> Market-implied closing lines: **unavailable** in ESPN historical scoreboard/summary for these events (odds arrays empty post-game). Not computed.

### Baseline comparison — FG spread home −3.5

| Engine | n | Brier | Log loss | ECE | bias |
|--------|---|-------|----------|-----|------|
| V2 | 790 | 0.2375 | 0.6875 | 0.0868 | -0.0779 |
| V1 | 790 | 0.2308 | 0.6631 | 0.0567 | -0.0511 |
| Hist | 790 | 0.2485 | 0.7135 | 0.0063 | -0.0025 |
| Team-strength N(μ,13.5) | 790 | 0.2400 | 0.7045 | 0.0985 | -0.0224 |

### Predicted vs actual scoring (V2 analytical quarter means)

| Period | n | Bias home | Bias away | Bias total | Bias margin | Pred total var* | Actual total var | Var ratio |
|--------|---|-----------|-----------|------------|-------------|-----------------|------------------|-----------|
| fg | 790 | -1.53 | 1.11 | -0.41 | -2.64 | 103.65 | 183.75 | 0.56 |
| q1 | 790 | -0.20 | 0.24 | 0.04 | -0.44 | 3.75 | 30.01 | 0.12 |
| q2 | 790 | -0.69 | 0.62 | -0.07 | -1.31 | 6.78 | 45.77 | 0.15 |
| q3 | 790 | -0.07 | 0.06 | -0.01 | -0.13 | 4.48 | 30.95 | 0.14 |
| q4 | 790 | -0.42 | 0.31 | -0.11 | -0.73 | 7.01 | 52.88 | 0.13 |
| h1 | 790 | -0.89 | 0.86 | -0.03 | -1.76 | 11.39 | 78.36 | 0.15 |
| h2 | 790 | -0.49 | 0.37 | -0.12 | -0.85 | 13.20 | 87.84 | 0.15 |

\*FG pred variance = mean MC variance over first 200 games (500 draws); period rows use variance of predicted means across games (understates process variance).

Sample consistency check: event 401437762 ok=true

### Historical data integrity

```json
{
  "rawGames": 854,
  "uniqueEventIds": 854,
  "duplicateEventIds": 0,
  "eligible": 790,
  "chronologicalEligible": true,
  "nonOtPeriodSumMatchesFinal": 744,
  "nonOtPeriodSumMismatch": 0,
  "formMinGamesViolations": 0,
  "homeAwaySource": "espn_competitor.homeAway",
  "leakageControl": "formBeforeKickoff filters kickoffMs < target",
  "marketClosingOddsInDataset": false
}
```

### Root-cause signals (this sport)

- FG total bias (pred−actual): **-0.41** pts
- FG margin bias: **-2.64**
- FG MC/actual var ratio: **0.56** (<1 ⇒ under-dispersed)
- Extreme spread ECE/bias: **0.1177** / **-0.1088**
- p≥0.90 bucket n=835, ECE=0.1813, bias=0.1813

## NCAAF

### Reliability by probability bucket (V2, all eval markets)

| Bucket | n | Pred p̄ | Outcome ȳ | Error (p̄−ȳ) |
|--------|---|---------|-----------|-------------|
| [0.0,0.1] | 4610 | 0.0424 | 0.1694 | -0.1270 |
| [0.1,0.2] | 3468 | 0.1496 | 0.2918 | -0.1422 |
| [0.2,0.3] | 3290 | 0.2494 | 0.3608 | -0.1114 |
| [0.3,0.4] | 3196 | 0.3496 | 0.4202 | -0.0706 |
| [0.4,0.5] | 3208 | 0.4501 | 0.4857 | -0.0355 |
| [0.5,0.6] | 3014 | 0.5498 | 0.5401 | 0.0097 |
| [0.6,0.7] | 3109 | 0.6499 | 0.5941 | 0.0558 |
| [0.7,0.8] | 2981 | 0.7493 | 0.6642 | 0.0851 |
| [0.8,0.9] | 2860 | 0.8493 | 0.7297 | 0.1195 |
| [0.9,1.0] | 2214 | 0.9451 | 0.8166 | 0.1285 |

### Reliability by probability bucket (V1, all eval markets)

| Bucket | n | Pred p̄ | Outcome ȳ | Error (p̄−ȳ) |
|--------|---|---------|-----------|-------------|
| [0.0,0.1] | 2252 | 0.0470 | 0.1390 | -0.0920 |
| [0.1,0.2] | 2813 | 0.1520 | 0.2161 | -0.0642 |
| [0.2,0.3] | 3517 | 0.2514 | 0.2912 | -0.0397 |
| [0.3,0.4] | 4222 | 0.3505 | 0.3624 | -0.0119 |
| [0.4,0.5] | 4549 | 0.4500 | 0.4660 | -0.0160 |
| [0.5,0.6] | 4521 | 0.5497 | 0.5583 | -0.0086 |
| [0.6,0.7] | 4018 | 0.6481 | 0.6354 | 0.0127 |
| [0.7,0.8] | 2935 | 0.7475 | 0.7199 | 0.0276 |
| [0.8,0.9] | 1955 | 0.8457 | 0.7642 | 0.0815 |
| [0.9,1.0] | 1168 | 0.9493 | 0.8151 | 0.1343 |

### Reliability — FG moneyline home (V2)

| Bucket | n | Pred p̄ | Outcome ȳ | Error (p̄−ȳ) |
|--------|---|---------|-----------|-------------|
| [0.0,0.1] | 98 | 0.0567 | 0.2143 | -0.1576 |
| [0.1,0.2] | 123 | 0.1502 | 0.3415 | -0.1912 |
| [0.2,0.3] | 144 | 0.2503 | 0.3333 | -0.0830 |
| [0.3,0.4] | 147 | 0.3502 | 0.5034 | -0.1532 |
| [0.4,0.5] | 147 | 0.4512 | 0.6395 | -0.1882 |
| [0.5,0.6] | 154 | 0.5495 | 0.6299 | -0.0803 |
| [0.6,0.7] | 138 | 0.6509 | 0.6594 | -0.0085 |
| [0.7,0.8] | 118 | 0.7488 | 0.7966 | -0.0478 |
| [0.8,0.9] | 119 | 0.8471 | 0.8319 | 0.0151 |
| [0.9,1.0] | 90 | 0.9492 | 0.8667 | 0.0825 |

### Calibration slices (V2)

| Slice | n | Brier | Log loss | ECE | bias | p̄ | ȳ |
|-------|---|-------|----------|-----|------|----|---|
| FG ML favorite (p>0.5) | 619 | 0.1842 | 0.5559 | 0.0459 | -0.0161 | 0.7254 | 0.7415 |
| FG ML underdog (p≤0.5) | 659 | 0.2482 | 0.7105 | 0.1534 | -0.1534 | 0.2699 | 0.4234 |
| Team total HOME overs (FG) | 5112 | 0.2190 | 0.6437 | 0.0849 | -0.0399 | 0.4881 | 0.5280 |
| Team total AWAY overs (FG) | 5112 | 0.2086 | 0.6143 | 0.0938 | 0.0778 | 0.4788 | 0.4010 |
| Main spreads (|line|≤7.5) | 3834 | 0.2124 | 0.6284 | 0.0957 | -0.0827 | 0.4353 | 0.5180 |
| Alt spreads (7.5<|line|<14) | 1278 | 0.2101 | 0.6515 | 0.1208 | -0.1085 | 0.2249 | 0.3333 |
| Extreme spreads (|line|≥14) | 2556 | 0.1908 | 0.6909 | 0.1369 | -0.1339 | 0.1278 | 0.2617 |
| Low totals (line<52.5) | 2556 | 0.2147 | 0.6323 | 0.0833 | 0.0526 | 0.7224 | 0.6698 |
| High totals (line≥52.5) | 3834 | 0.2165 | 0.6264 | 0.0619 | 0.0025 | 0.3689 | 0.3665 |
| Period=fg | 25560 | 0.2118 | 0.6365 | 0.0778 | -0.0224 | 0.4348 | 0.4572 |
| Period=h1 | 3834 | 0.2599 | 0.7541 | 0.1373 | -0.0297 | 0.4894 | 0.5190 |
| Period=q2 | 2556 | 0.2542 | 0.7716 | 0.1406 | -0.0066 | 0.6022 | 0.6088 |
| V2 p≥0.8 | 5074 | 0.1913 | 0.6208 | 0.1235 | 0.1235 | 0.8911 | 0.7676 |
| V2 p≤0.20 | 8078 | 0.1854 | 0.6359 | 0.1335 | -0.1335 | 0.0884 | 0.2220 |
| V2 p≥0.9 | 2214 | 0.1654 | 0.6069 | 0.1285 | 0.1285 | 0.9451 | 0.8166 |
| V2 p≤0.10 | 4610 | 0.1546 | 0.6107 | 0.1270 | -0.1270 | 0.0424 | 0.1694 |
| V2 p≥0.95 | 958 | 0.1576 | 0.6595 | 0.1397 | 0.1397 | 0.9727 | 0.8330 |
| V2 p≤0.05 | 2742 | 0.1309 | 0.6023 | 0.1168 | -0.1168 | 0.0207 | 0.1375 |

### Game-clustered uncertainty (bootstrap SE over eventId)

| Scope | n rows | Brier | Brier SE | ECE | ECE SE | n games |
|-------|--------|-------|----------|-----|--------|---------|
| All markets | 31950 | 0.2209 | 0.0031 | 0.0897 | 0.0047 | 1278 |
| FG ML | 1278 | 0.2172 | 0.0066 | 0.1014 | 0.0122 | 1278 |
| FG spreads | 7668 | 0.2048 | 0.0054 | 0.1115 | 0.0085 | 1278 |
| FG totals | 6390 | 0.2158 | 0.0038 | 0.0623 | 0.0065 | 1278 |
| Extreme spreads | 2556 | 0.1908 | 0.0084 | 0.1369 | 0.0104 | 1278 |

### Baseline comparison — FG moneyline home (identical games)

| Engine | n | Brier | Log loss | ECE | bias | p̄ | ȳ |
|--------|---|-------|----------|-----|------|----|---|
| V2 joint | 1278 | 0.2172 | 0.6357 | 0.1014 | -0.0869 | 0.4906 | 0.5775 |
| V1 frac | 1278 | 0.2109 | 0.6116 | 0.0771 | -0.0747 | 0.5027 | 0.5775 |
| Hist frequency | 1278 | 0.2456 | 0.6987 | 0.0138 | -0.0006 | 0.5768 | 0.5775 |
| Coin 0.5 | 1278 | 0.2500 | 0.6931 | 0.0775 | -0.0775 | 0.5000 | 0.5775 |
| Team-strength logistic | 1278 | 0.2342 | 0.7413 | 0.1592 | -0.0719 | 0.5056 | 0.5775 |
| Market-implied closing | 0 | n/a | n/a | n/a | 0.0000 | 0.0000 | 0.0000 |

> Market-implied closing lines: **unavailable** in ESPN historical scoreboard/summary for these events (odds arrays empty post-game). Not computed.

### Baseline comparison — FG spread home −3.5

| Engine | n | Brier | Log loss | ECE | bias |
|--------|---|-------|----------|-----|------|
| V2 | 1278 | 0.2268 | 0.6644 | 0.1066 | -0.0916 |
| V1 | 1278 | 0.2187 | 0.6312 | 0.0719 | -0.0653 |
| Hist | 1278 | 0.2519 | 0.7116 | 0.0274 | -0.0054 |
| Team-strength N(μ,13.5) | 1278 | 0.2356 | 0.7471 | 0.1388 | -0.0505 |

### Predicted vs actual scoring (V2 analytical quarter means)

| Period | n | Bias home | Bias away | Bias total | Bias margin | Pred total var* | Actual total var | Var ratio |
|--------|---|-----------|-----------|------------|-------------|-----------------|------------------|-----------|
| fg | 1278 | -2.18 | 1.74 | -0.45 | -3.92 | 180.89 | 289.93 | 0.62 |
| q1 | 1278 | -0.45 | 0.61 | 0.16 | -1.06 | 7.81 | 49.73 | 0.16 |
| q2 | 1278 | -0.71 | 0.78 | 0.07 | -1.48 | 8.61 | 63.39 | 0.14 |
| q3 | 1278 | -0.30 | 0.38 | 0.08 | -0.68 | 6.56 | 52.35 | 0.13 |
| q4 | 1278 | -0.46 | 0.20 | -0.26 | -0.67 | 9.26 | 65.82 | 0.14 |
| h1 | 1278 | -1.15 | 1.39 | 0.23 | -2.54 | 19.67 | 123.11 | 0.16 |
| h2 | 1278 | -0.77 | 0.58 | -0.18 | -1.35 | 16.54 | 121.41 | 0.14 |

\*FG pred variance = mean MC variance over first 200 games (500 draws); period rows use variance of predicted means across games (understates process variance).

Sample consistency check: event 401520253 ok=true

### Historical data integrity

```json
{
  "rawGames": 1739,
  "uniqueEventIds": 1739,
  "duplicateEventIds": 0,
  "eligible": 1278,
  "chronologicalEligible": true,
  "nonOtPeriodSumMatchesFinal": 1225,
  "nonOtPeriodSumMismatch": 0,
  "formMinGamesViolations": 0,
  "homeAwaySource": "espn_competitor.homeAway",
  "leakageControl": "formBeforeKickoff filters kickoffMs < target",
  "marketClosingOddsInDataset": false
}
```

### Root-cause signals (this sport)

- FG total bias (pred−actual): **-0.45** pts
- FG margin bias: **-3.92**
- FG MC/actual var ratio: **0.62** (<1 ⇒ under-dispersed)
- Extreme spread ECE/bias: **0.1369** / **-0.1339**
- p≥0.90 bucket n=2214, ECE=0.1285, bias=0.1285

## Failure origin assessment

| Candidate cause | Verdict | Rationale |
|-----------------|---------|-----------|
| Model scoring assumptions | **PRIMARY** | FG total/margin biases + under-dispersion (var ratio < 1) drive miscalibrated cover probs; extreme alts systematically under-predict large margins. |
| Probability distribution shape | **PRIMARY** | Independent Poisson quarters → thin tails vs football blowouts/red-zone clustering; high-p and extreme-spread slices show largest ECE. |
| Period allocation | **SECONDARY** | Joint conservation is correct (0 breaks); period ECE worse than FG because quarter variance is too low relative to actuals, not because of frac overwrite. |
| Calibration mapping | **NOT PRIMARY** | Failures appear before any post-hoc calibrator; raw simHit vs outcomes already misaligned — a Platt/isotonic layer would mask, not fix, scoring errors. |
| Historical feature quality | **SECONDARY** | L4 means are noisy; team-strength logistic sometimes competitive on ML ECE; no QB/rest/market features. |
| Evaluation methodology | **MINOR** | Grid lines ≠ closing lines (market baseline missing); still valid for model-vs-outcome calibration. Hist frequency baseline is slightly optimistic (online update) but does not create V2 ECE failure. |
| Data integrity / leakage | **CLEARED** | No duplicate eventIds in primary caches; chronological eligible order; form uses kickoffMs < target; non-OT quarter sums match finals; home/away from ESPN `homeAway`. |

## Smallest defensible model improvements (proposal only — do not implement yet)

1. **Heavy-tail / correlated scoring:** shared game factor with higher σ + optional negative-binomial or inflate P(margin ≥ 14). Addresses extreme-alt under-prediction.
2. **Variance recalibration of quarters:** scale quarter λ noise so MC total variance matches empirical FG total variance (sport-specific), preserving mean conservation.
3. **Home-field / margin prior:** small additive home mean (NFL ~2.0, NCAAF ~2.5) from pre-kickoff league constants — not fit on holdout.
4. **Feature window:** L8 or season-to-date with recency weights (still leak-free).
5. **Defer post-hoc probability calibration** until (1)–(3) improve raw ECE; then fit isotonic on a **chronological train** only.

## Chronological OOS validation plan (no holdout fitting)

| Fold | Train (form + any calibrator fit) | Test (report only) |
|------|-----------------------------------|--------------------|
| NFL A | 2022 season games | 2023 season |
| NFL B | 2022–2023 | 2024 season |
| NCAAF A | 2023 weeks 1–8 | 2023 weeks 9–15 |
| NCAAF B | 2023 full | 2024 full |

Rules:
- Freeze model hyperparameters using train folds only (or prior scientific defaults).
- Never update calibrator using test-fold outcomes.
- Report game-clustered CIs on each test fold.
- Keep `SIM_V2_SERVE=off` / empty `ACCEPTED_FAMILIES` until every sport:family passes ECE≤0.04 on the **latest** test fold with n≥500.

## Affected files (audit artifacts only)

| Path | Role |
|------|------|
| `eval/auditCalibrationRootCause.ts` | Read-only audit runner |
| `eval/report/CALIBRATION_ROOT_CAUSE_AUDIT.md` | This report |
| `eval/report/*_observations.json` | Input probs (gitignored locally) |
| `eval/cache/*.json` | ESPN game cache (gitignored) |
| `eval/report/*_summary.json` | Prior validation summaries |

**Not modified:** joint football model, feature flags, Coach, P0, OTA, PR #649.
