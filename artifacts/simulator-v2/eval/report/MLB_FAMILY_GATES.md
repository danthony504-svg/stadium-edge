# MLB sport:family gates

Shadow-only family verdicts on chronological holdout (55/20/25). Never tune on holdout.

| Family | Verdict | n | games | effN | Brier | LogLoss | ECE | ECE_SE | bias | reasons |
|--------|---------|---|-------|------|-------|---------|-----|--------|------|---------|
| mlb:ml | **FAIL** | 560 | 560 | 560.0 | 0.2570 | 0.7075 | 0.1095 | 0.0198 | -0.110 | ece_0.1095_gt_0.04 |
| mlb:spread | **FAIL** | 1120 | 560 | 560.0 | 0.2165 | 0.6256 | 0.0567 | 0.0191 | -0.057 | ece_0.0567_gt_0.04 |
| mlb:total | **FAIL** | 1120 | 560 | 560.0 | 0.2415 | 0.6772 | 0.0495 | 0.0099 | -0.014 | ece_0.0495_gt_0.04 |
| mlb:team_total | **FAIL** | 560 | 560 | 560.0 | 0.2532 | 0.6997 | 0.0665 | 0.0178 | 0.003 | ece_0.0665_gt_0.04 |
| mlb:f5 | **FAIL** | 1680 | 560 | 560.0 | 0.2501 | 0.6938 | 0.0411 | 0.0100 | -0.014 | ece_0.0411_gt_0.04 |
| mlb:main_all | **FAIL** | 3360 | 560 | 560.0 | 0.2495 | 0.6922 | 0.0590 | 0.0121 | -0.027 | ece_0.0590_gt_0.04 |
| mlb:alt_all | **FAIL** | 1680 | 560 | 560.0 | 0.2266 | 0.6469 | 0.0606 | 0.0116 | -0.043 | ece_0.0606_gt_0.04 |
| mlb:closing_line_benchmark | **INSUFFICIENT_DATA** | 0 | 0 | 0.0 | n/a | n/a | n/a | n/a | 0.000 | closing_line_unavailable_unlicensed |
| mlb:player_prop_named | **FAIL** | 2880 | 120 | 120.0 | 0.2095 | 0.6235 | 0.0919 | 0.0074 | 0.011 | ece_0.0919_gt_0.04 |

## Notes
- minOosSample=500, maxEce=0.04 from acceptanceGates
- effectiveN = Kish ESS from game clusters
- closing_line_benchmark → INSUFFICIENT_DATA (unlicensed)
- player_prop_named → FAIL (n=2880)
