# NHL A/B family gates — v0.2 vs v0.3

Shadow-only. Thresholds: minOos=500, maxEce=0.04.

## v0.2.0 gates
| Family | Verdict | n | games | effN | Brier | LogLoss | ECE | ECE_SE | mad½ | bias | overconf90 | reasons |
|--------|---------|---|-------|------|-------|---------|-----|--------|------|------|------------|---------|
| nhl:ml_final | **INSUFFICIENT_DATA** | 316 | 316 | 316.0 | 0.2553 | 0.7061 | 0.0832 | 0.0232 | 0.1102 | -0.026 | n/a(n=0) | oos_sample_316_lt_500; ece_0.0832_gt_0.04 |
| nhl:ml_regulation | **INSUFFICIENT_DATA** | 316 | 316 | 316.0 | 0.2594 | 0.7166 | 0.0909 | 0.0231 | 0.1099 | -0.002 | n/a(n=0) | oos_sample_316_lt_500; ece_0.0909_gt_0.04 |
| nhl:spread | **INSUFFICIENT_DATA** | 316 | 316 | 316.0 | 0.2432 | 0.6902 | 0.0994 | 0.0239 | 0.2053 | -0.063 | n/a(n=0) | oos_sample_316_lt_500; ece_0.0994_gt_0.04 |
| nhl:total_final | **INSUFFICIENT_DATA** | 316 | 316 | 316.0 | 0.2599 | 0.7169 | 0.1159 | 0.0257 | 0.1072 | 0.005 | n/a(n=0) | oos_sample_316_lt_500; ece_0.1159_gt_0.04 |
| nhl:total_regulation | **INSUFFICIENT_DATA** | 316 | 316 | 316.0 | 0.2599 | 0.7169 | 0.1159 | 0.0259 | 0.1072 | 0.005 | n/a(n=0) | oos_sample_316_lt_500; ece_0.1159_gt_0.04 |
| nhl:team_total | **FAIL** | 632 | 316 | 316.0 | 0.2516 | 0.7015 | 0.0864 | 0.0221 | 0.1392 | 0.022 | n/a(n=0) | ece_0.0864_gt_0.04 |
| nhl:alt_spread | **INSUFFICIENT_DATA** | 316 | 316 | 316.0 | 0.1730 | 0.5466 | 0.0634 | 0.0181 | 0.3213 | -0.027 | n/a(n=0) | oos_sample_316_lt_500; ece_0.0634_gt_0.04 |
| nhl:alt_total | **INSUFFICIENT_DATA** | 316 | 316 | 316.0 | 0.2547 | 0.7035 | 0.0935 | 0.0238 | 0.0933 | 0.048 | n/a(n=0) | oos_sample_316_lt_500; ece_0.0935_gt_0.04 |
| nhl:alt_player_prop | **INSUFFICIENT_DATA** | 240 | 60 | 60.0 | 0.2385 | 0.6700 | 0.4868 | 0.0045 | 0.0339 | 0.487 | n/a(n=0) | oos_sample_240_lt_500; ece_0.4868_gt_0.04 |
| nhl:alt_all | **FAIL** | 872 | 316 | 238.8 | 0.2207 | 0.6374 | 0.1765 | 0.0164 | 0.1596 | 0.142 | n/a(n=0) | ece_0.1765_gt_0.04 |
| nhl:main_all | **FAIL** | 2812 | 316 | 264.6 | 0.2647 | 0.7299 | 0.1308 | 0.0117 | 0.1557 | 0.071 | n/a(n=0) | ece_0.1308_gt_0.04 |
| nhl:player_prop_named | **FAIL** | 840 | 60 | 60.0 | 0.2843 | 0.7727 | 0.3926 | 0.0096 | 0.1854 | 0.393 | n/a(n=0) | ece_0.3926_gt_0.04 |

## v0.3.0 gates
| Family | Verdict | n | games | effN | Brier | LogLoss | ECE | ECE_SE | mad½ | bias | overconf90 | reasons |
|--------|---------|---|-------|------|-------|---------|-----|--------|------|------|------------|---------|
| nhl:ml_final | **INSUFFICIENT_DATA** | 316 | 316 | 316.0 | 0.2485 | 0.6904 | 0.0410 | 0.0191 | 0.0667 | -0.038 | n/a(n=0) | oos_sample_316_lt_500; ece_0.0410_gt_0.04 |
| nhl:ml_regulation | **INSUFFICIENT_DATA** | 316 | 316 | 316.0 | 0.2511 | 0.6961 | 0.0329 | 0.0177 | 0.0804 | -0.014 | n/a(n=0) | oos_sample_316_lt_500 |
| nhl:spread | **INSUFFICIENT_DATA** | 316 | 316 | 316.0 | 0.2378 | 0.6725 | 0.0896 | 0.0256 | 0.2112 | -0.072 | n/a(n=0) | oos_sample_316_lt_500; ece_0.0896_gt_0.04 |
| nhl:total_final | **INSUFFICIENT_DATA** | 316 | 316 | 316.0 | 0.2515 | 0.6972 | 0.0769 | 0.0250 | 0.0842 | 0.009 | n/a(n=0) | oos_sample_316_lt_500; ece_0.0769_gt_0.04 |
| nhl:total_regulation | **INSUFFICIENT_DATA** | 316 | 316 | 316.0 | 0.2515 | 0.6972 | 0.0769 | 0.0262 | 0.0842 | 0.009 | n/a(n=0) | oos_sample_316_lt_500; ece_0.0769_gt_0.04 |
| nhl:team_total | **FAIL** | 632 | 316 | 316.0 | 0.2444 | 0.6829 | 0.0461 | 0.0180 | 0.1126 | 0.016 | n/a(n=0) | ece_0.0461_gt_0.04 |
| nhl:alt_spread | **INSUFFICIENT_DATA** | 316 | 316 | 316.0 | 0.1687 | 0.5282 | 0.0455 | 0.0176 | 0.3269 | -0.033 | n/a(n=0) | oos_sample_316_lt_500; ece_0.0455_gt_0.04 |
| nhl:alt_total | **INSUFFICIENT_DATA** | 316 | 316 | 316.0 | 0.2475 | 0.6879 | 0.0635 | 0.0216 | 0.0592 | 0.053 | n/a(n=0) | oos_sample_316_lt_500; ece_0.0635_gt_0.04 |
| nhl:alt_player_prop | **INSUFFICIENT_DATA** | 240 | 60 | 60.0 | 0.2385 | 0.6701 | 0.4877 | 0.0028 | 0.0228 | 0.488 | n/a(n=0) | oos_sample_240_lt_500; ece_0.4877_gt_0.04 |
| nhl:alt_all | **FAIL** | 872 | 316 | 238.8 | 0.2164 | 0.6251 | 0.1700 | 0.0167 | 0.1462 | 0.142 | n/a(n=0) | ece_0.1700_gt_0.04 |
| nhl:main_all | **FAIL** | 2812 | 316 | 264.6 | 0.2589 | 0.7152 | 0.1056 | 0.0117 | 0.1370 | 0.067 | n/a(n=0) | ece_0.1056_gt_0.04 |
| nhl:player_prop_named | **FAIL** | 840 | 60 | 60.0 | 0.2843 | 0.7727 | 0.3931 | 0.0090 | 0.1823 | 0.393 | n/a(n=0) | ece_0.3931_gt_0.04 |

## Compact gate table (shared formatter)
### v0.2
| Family | Verdict | n | games | effN | Brier | LogLoss | ECE | ECE_SE | bias | reasons |
|--------|---------|---|-------|------|-------|---------|-----|--------|------|---------|
| nhl:ml_final | **INSUFFICIENT_DATA** | 316 | 316 | 316.0 | 0.2553 | 0.7061 | 0.0832 | 0.0232 | -0.026 | oos_sample_316_lt_500; ece_0.0832_gt_0.04 |
| nhl:ml_regulation | **INSUFFICIENT_DATA** | 316 | 316 | 316.0 | 0.2594 | 0.7166 | 0.0909 | 0.0231 | -0.002 | oos_sample_316_lt_500; ece_0.0909_gt_0.04 |
| nhl:spread | **INSUFFICIENT_DATA** | 316 | 316 | 316.0 | 0.2432 | 0.6902 | 0.0994 | 0.0239 | -0.063 | oos_sample_316_lt_500; ece_0.0994_gt_0.04 |
| nhl:total_final | **INSUFFICIENT_DATA** | 316 | 316 | 316.0 | 0.2599 | 0.7169 | 0.1159 | 0.0257 | 0.005 | oos_sample_316_lt_500; ece_0.1159_gt_0.04 |
| nhl:total_regulation | **INSUFFICIENT_DATA** | 316 | 316 | 316.0 | 0.2599 | 0.7169 | 0.1159 | 0.0259 | 0.005 | oos_sample_316_lt_500; ece_0.1159_gt_0.04 |
| nhl:team_total | **FAIL** | 632 | 316 | 316.0 | 0.2516 | 0.7015 | 0.0864 | 0.0221 | 0.022 | ece_0.0864_gt_0.04 |
| nhl:alt_spread | **INSUFFICIENT_DATA** | 316 | 316 | 316.0 | 0.1730 | 0.5466 | 0.0634 | 0.0181 | -0.027 | oos_sample_316_lt_500; ece_0.0634_gt_0.04 |
| nhl:alt_total | **INSUFFICIENT_DATA** | 316 | 316 | 316.0 | 0.2547 | 0.7035 | 0.0935 | 0.0238 | 0.048 | oos_sample_316_lt_500; ece_0.0935_gt_0.04 |
| nhl:alt_player_prop | **INSUFFICIENT_DATA** | 240 | 60 | 60.0 | 0.2385 | 0.6700 | 0.4868 | 0.0045 | 0.487 | oos_sample_240_lt_500; ece_0.4868_gt_0.04 |
| nhl:alt_all | **FAIL** | 872 | 316 | 238.8 | 0.2207 | 0.6374 | 0.1765 | 0.0164 | 0.142 | ece_0.1765_gt_0.04 |
| nhl:main_all | **FAIL** | 2812 | 316 | 264.6 | 0.2647 | 0.7299 | 0.1308 | 0.0117 | 0.071 | ece_0.1308_gt_0.04 |
| nhl:player_prop_named | **FAIL** | 840 | 60 | 60.0 | 0.2843 | 0.7727 | 0.3926 | 0.0096 | 0.393 | ece_0.3926_gt_0.04 |

### v0.3
| Family | Verdict | n | games | effN | Brier | LogLoss | ECE | ECE_SE | bias | reasons |
|--------|---------|---|-------|------|-------|---------|-----|--------|------|---------|
| nhl:ml_final | **INSUFFICIENT_DATA** | 316 | 316 | 316.0 | 0.2485 | 0.6904 | 0.0410 | 0.0191 | -0.038 | oos_sample_316_lt_500; ece_0.0410_gt_0.04 |
| nhl:ml_regulation | **INSUFFICIENT_DATA** | 316 | 316 | 316.0 | 0.2511 | 0.6961 | 0.0329 | 0.0177 | -0.014 | oos_sample_316_lt_500 |
| nhl:spread | **INSUFFICIENT_DATA** | 316 | 316 | 316.0 | 0.2378 | 0.6725 | 0.0896 | 0.0256 | -0.072 | oos_sample_316_lt_500; ece_0.0896_gt_0.04 |
| nhl:total_final | **INSUFFICIENT_DATA** | 316 | 316 | 316.0 | 0.2515 | 0.6972 | 0.0769 | 0.0250 | 0.009 | oos_sample_316_lt_500; ece_0.0769_gt_0.04 |
| nhl:total_regulation | **INSUFFICIENT_DATA** | 316 | 316 | 316.0 | 0.2515 | 0.6972 | 0.0769 | 0.0262 | 0.009 | oos_sample_316_lt_500; ece_0.0769_gt_0.04 |
| nhl:team_total | **FAIL** | 632 | 316 | 316.0 | 0.2444 | 0.6829 | 0.0461 | 0.0180 | 0.016 | ece_0.0461_gt_0.04 |
| nhl:alt_spread | **INSUFFICIENT_DATA** | 316 | 316 | 316.0 | 0.1687 | 0.5282 | 0.0455 | 0.0176 | -0.033 | oos_sample_316_lt_500; ece_0.0455_gt_0.04 |
| nhl:alt_total | **INSUFFICIENT_DATA** | 316 | 316 | 316.0 | 0.2475 | 0.6879 | 0.0635 | 0.0216 | 0.053 | oos_sample_316_lt_500; ece_0.0635_gt_0.04 |
| nhl:alt_player_prop | **INSUFFICIENT_DATA** | 240 | 60 | 60.0 | 0.2385 | 0.6701 | 0.4877 | 0.0028 | 0.488 | oos_sample_240_lt_500; ece_0.4877_gt_0.04 |
| nhl:alt_all | **FAIL** | 872 | 316 | 238.8 | 0.2164 | 0.6251 | 0.1700 | 0.0167 | 0.142 | ece_0.1700_gt_0.04 |
| nhl:main_all | **FAIL** | 2812 | 316 | 264.6 | 0.2589 | 0.7152 | 0.1056 | 0.0117 | 0.067 | ece_0.1056_gt_0.04 |
| nhl:player_prop_named | **FAIL** | 840 | 60 | 60.0 | 0.2843 | 0.7727 | 0.3931 | 0.0090 | 0.393 | ece_0.3931_gt_0.04 |

## Overall: v0.2=**FAIL** | v0.3=**FAIL** | shrink_to_50=ok
