# MLB A/B family gates (v0.2 vs v0.3)

Shadow-only. Thresholds **not loosened**: minOosSample=500, maxEce=0.04.
Identical frozen chronological holdout for both profiles.

## Verdict summary (v0.3 corrected)

| Family | v0.2 | v0.3 | ΔECE | ΔBrier | ΔLogLoss | shrink-to-50 |
|--------|------|------|------|--------|----------|--------------|
| ml | **FAIL** | **FAIL** | -0.0168 | -0.0032 | -0.0080 | FLAG |
| spread | **FAIL** | **FAIL** | -0.0085 | -0.0022 | -0.0089 | ok |
| total | **FAIL** | **FAIL** | -0.0204 | -0.0050 | -0.0133 | ok |
| team_total | **FAIL** | **FAIL** | -0.0631 | -0.0104 | -0.0227 | FLAG |
| f5 | **FAIL** | **PASS** | -0.0283 | -0.0055 | -0.0123 | ok |
| main_all | **FAIL** | **FAIL** | -0.0304 | -0.0052 | -0.0119 | ok |
| alt_all | **FAIL** | **FAIL** | -0.0094 | -0.0045 | -0.0134 | ok |
| player_prop_named | **FAIL** | **FAIL** | -0.0001 | +0.0002 | +0.0008 | ok |
| closing_line | **INSUFFICIENT_DATA** | **INSUFFICIENT_DATA** | n/a | n/a | n/a | n/a |

## Blockers

- ml:v0.3 FAIL — ece_0.1110_gt_0.04
- spread:v0.3 FAIL — ece_0.0569_gt_0.04
- total:v0.3 FAIL — ece_0.0507_gt_0.04
- team_total:v0.3 FAIL — ece_0.0508_gt_0.04
- main_all:v0.3 FAIL — ece_0.0576_gt_0.04
- alt_all:v0.3 FAIL — ece_0.0605_gt_0.04
- player_prop_named:v0.3 FAIL — ece_0.0917_gt_0.04
- closing_line_benchmark: INSUFFICIENT_DATA (unlicensed)
- shrink_to_50_suspect: ml, team_total

## Full gate rows

### v0.2
| Family | Verdict | n | games | effN | Brier | LogLoss | ECE | ECE_SE | bias | reasons |
|--------|---------|---|-------|------|-------|---------|-----|--------|------|---------|
| mlb:ml:v0.2 | **FAIL** | 560 | 560 | 560.0 | 0.2614 | 0.7180 | 0.1278 | 0.0194 | -0.108 | ece_0.1278_gt_0.04 |
| mlb:spread:v0.2 | **FAIL** | 1120 | 560 | 560.0 | 0.2189 | 0.6344 | 0.0654 | 0.0163 | -0.059 | ece_0.0654_gt_0.04 |
| mlb:total:v0.2 | **FAIL** | 1120 | 560 | 560.0 | 0.2470 | 0.6917 | 0.0711 | 0.0117 | -0.004 | ece_0.0711_gt_0.04 |
| mlb:team_total:v0.2 | **FAIL** | 560 | 560 | 560.0 | 0.2631 | 0.7213 | 0.1139 | 0.0182 | 0.015 | ece_0.1139_gt_0.04 |
| mlb:f5:v0.2 | **FAIL** | 1680 | 560 | 560.0 | 0.2562 | 0.7073 | 0.0680 | 0.0104 | -0.008 | ece_0.0680_gt_0.04 |
| mlb:main_all:v0.2 | **FAIL** | 3360 | 560 | 560.0 | 0.2551 | 0.7051 | 0.0880 | 0.0127 | -0.020 | ece_0.0880_gt_0.04 |
| mlb:alt_all:v0.2 | **FAIL** | 1680 | 560 | 560.0 | 0.2314 | 0.6610 | 0.0699 | 0.0106 | -0.041 | ece_0.0699_gt_0.04 |
| mlb:player_prop_named:v0.2 | **FAIL** | 2880 | 120 | 120.0 | 0.2092 | 0.6229 | 0.0918 | 0.0074 | 0.011 | ece_0.0918_gt_0.04 |

### v0.3
| Family | Verdict | n | games | effN | Brier | LogLoss | ECE | ECE_SE | bias | reasons |
|--------|---------|---|-------|------|-------|---------|-----|--------|------|---------|
| mlb:ml:v0.3 | **FAIL** | 560 | 560 | 560.0 | 0.2582 | 0.7100 | 0.1110 | 0.0194 | -0.111 | ece_0.1110_gt_0.04 |
| mlb:spread:v0.3 | **FAIL** | 1120 | 560 | 560.0 | 0.2167 | 0.6256 | 0.0569 | 0.0194 | -0.057 | ece_0.0569_gt_0.04 |
| mlb:total:v0.3 | **FAIL** | 1120 | 560 | 560.0 | 0.2420 | 0.6783 | 0.0507 | 0.0103 | -0.015 | ece_0.0507_gt_0.04 |
| mlb:team_total:v0.3 | **FAIL** | 560 | 560 | 560.0 | 0.2526 | 0.6986 | 0.0508 | 0.0169 | 0.001 | ece_0.0508_gt_0.04 |
| mlb:f5:v0.3 | **PASS** | 1680 | 560 | 560.0 | 0.2507 | 0.6950 | 0.0397 | 0.0102 | -0.015 | — |
| mlb:main_all:v0.3 | **FAIL** | 3360 | 560 | 560.0 | 0.2499 | 0.6932 | 0.0576 | 0.0119 | -0.028 | ece_0.0576_gt_0.04 |
| mlb:alt_all:v0.3 | **FAIL** | 1680 | 560 | 560.0 | 0.2269 | 0.6475 | 0.0605 | 0.0124 | -0.044 | ece_0.0605_gt_0.04 |
| mlb:player_prop_named:v0.3 | **FAIL** | 2880 | 120 | 120.0 | 0.2094 | 0.6237 | 0.0917 | 0.0074 | 0.011 | ece_0.0917_gt_0.04 |

### Closing line
| Family | Verdict | n | games | effN | Brier | LogLoss | ECE | ECE_SE | bias | reasons |
|--------|---------|---|-------|------|-------|---------|-----|--------|------|---------|
| mlb:closing_line_benchmark | **INSUFFICIENT_DATA** | 0 | 0 | 0.0 | n/a | n/a | n/a | n/a | 0.000 | closing_line_unavailable_unlicensed |
