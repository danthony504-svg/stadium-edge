# NHL A/B holdout — hockey.joint v0.2.0 vs v0.3.0

Shadow-only independent OOS A/B on **identical chrono holdout**. No serve/allowlists/Coach/P0/merge/OTA.

## Freeze
- Protocol: `nhl_ab_chrono_holdout_v1`
- Train: 2023 (n=1998); val diagnostic early-2024 (n=1117)
- Holdout pool mid+late-2024 (n=915); graded cap 320 eventIds
- Freeze manifest: `eval/report/nhl_ab_holdout_freeze.json`
- Games graded: v0.2=316, v0.3=316 (must match)
- Gates unchanged: maxEce=0.04, minOos=500

## Profiles
| Profile | Version | shrink | shock σ | HFA |
|---------|---------|--------|---------|-----|
| v0.2 | 0.2.0 | 0 | 0 | 0.15 |
| v0.3 | 0.3.0 | 0.4 | 0.15 | 0.08 |

## Before / after (primary families)
| Family | v0.2 ECE | v0.3 ECE | ΔECE | v0.2 Brier | v0.3 Brier | v0.2 mad½ | v0.3 mad½ | v0.2 n | v0.3 n | v0.2 verdict | v0.3 verdict |
|--------|----------|----------|------|------------|------------|-----------|-----------|--------|--------|--------------|--------------|
| nhl:ml_final | 0.0832 | 0.0410 | -0.0422 | 0.2553 | 0.2485 | 0.1102 | 0.0667 | 316 | 316 | **INSUFFICIENT_DATA** | **INSUFFICIENT_DATA** |
| nhl:ml_regulation | 0.0909 | 0.0329 | -0.0580 | 0.2594 | 0.2511 | 0.1099 | 0.0804 | 316 | 316 | **INSUFFICIENT_DATA** | **INSUFFICIENT_DATA** |
| nhl:spread | 0.0994 | 0.0896 | -0.0098 | 0.2432 | 0.2378 | 0.2053 | 0.2112 | 316 | 316 | **INSUFFICIENT_DATA** | **INSUFFICIENT_DATA** |
| nhl:total_final | 0.1159 | 0.0769 | -0.0390 | 0.2599 | 0.2515 | 0.1072 | 0.0842 | 316 | 316 | **INSUFFICIENT_DATA** | **INSUFFICIENT_DATA** |
| nhl:total_regulation | 0.1159 | 0.0769 | -0.0390 | 0.2599 | 0.2515 | 0.1072 | 0.0842 | 316 | 316 | **INSUFFICIENT_DATA** | **INSUFFICIENT_DATA** |
| nhl:team_total | 0.0864 | 0.0461 | -0.0403 | 0.2516 | 0.2444 | 0.1392 | 0.1126 | 632 | 632 | **FAIL** | **FAIL** |
| nhl:alt_spread | 0.0634 | 0.0455 | -0.0180 | 0.1730 | 0.1687 | 0.3213 | 0.3269 | 316 | 316 | **INSUFFICIENT_DATA** | **INSUFFICIENT_DATA** |
| nhl:alt_total | 0.0935 | 0.0635 | -0.0300 | 0.2547 | 0.2475 | 0.0933 | 0.0592 | 316 | 316 | **INSUFFICIENT_DATA** | **INSUFFICIENT_DATA** |
| nhl:alt_player_prop | 0.4868 | 0.4877 | 0.0009 | 0.2385 | 0.2385 | 0.0339 | 0.0228 | 240 | 240 | **INSUFFICIENT_DATA** | **INSUFFICIENT_DATA** |
| nhl:alt_all | 0.1765 | 0.1700 | -0.0065 | 0.2207 | 0.2164 | 0.1596 | 0.1462 | 872 | 872 | **FAIL** | **FAIL** |
| nhl:main_all | 0.1308 | 0.1056 | -0.0252 | 0.2647 | 0.2589 | 0.1557 | 0.1370 | 2812 | 2812 | **FAIL** | **FAIL** |
| nhl:player_prop_named | 0.3926 | 0.3931 | 0.0006 | 0.2843 | 0.2843 | 0.1854 | 0.1823 | 840 | 840 | **FAIL** | **FAIL** |

## Shrink-to-50 check (main_all)
- Not flagged. ECE/mad½/variance pattern OK or inconclusive.
- meanAbsDevFromHalf: v0.2=0.1557 → v0.3=0.1370
- ECE: v0.2=0.1308 → v0.3=0.1056

## Scoring variance (sim draw var vs actual reg team goals)
| Profile | actualVar | meanSimDrawVar | varRatio |
|---------|-----------|----------------|----------|
| v0.2 | 3.048 | 3.079 | 1.010 |
| v0.3 | 3.048 | 3.319 | 1.089 |

### Distribution check v0.2
| Dist | n | actMean | simMean | err | actVar | simVar | varRatio | actP90 | simP90 |
|------|---|---------|---------|-----|--------|--------|----------|--------|--------|
| nhl_reg_team_goals | 632 | 2.98 | 3.07 | 0.10 | 3.05 | 0.31 | 0.10 | 5.0 | 3.8 |
| nhl_final_total | 316 | 6.15 | 6.31 | 0.16 | 5.49 | 0.49 | 0.09 | 9.0 | 7.2 |
| nhl_final_margin | 316 | 0.26 | 0.19 | -0.07 | 6.70 | 0.70 | 0.10 | 3.0 | 1.2 |

### Distribution check v0.3
| Dist | n | actMean | simMean | err | actVar | simVar | varRatio | actP90 | simP90 |
|------|---|---------|---------|-----|--------|--------|----------|--------|--------|
| nhl_reg_team_goals | 632 | 2.98 | 3.10 | 0.12 | 3.05 | 0.11 | 0.04 | 5.0 | 3.5 |
| nhl_final_total | 316 | 6.15 | 6.35 | 0.20 | 5.49 | 0.18 | 0.03 | 9.0 | 6.9 |
| nhl_final_margin | 316 | 0.26 | 0.11 | -0.14 | 6.70 | 0.26 | 0.04 | 3.0 | 0.7 |

## Runtime (ms / game)
| Profile | mean | p90 | p95 |
|---------|------|-----|-----|
| v0.2 | 1.9 | 4.3 | 5.5 |
| v0.3 | 2.1 | 4.5 | 6.0 |

## Named player props
- Verified athlete IDs only; unverified identity rejected.
- v0.2 prop games=60 obs=840 rejected=0
- v0.3 prop games=60 obs=840 rejected=0

## Reliability (v0.3 main_all holdout)
| bin | n | avgPred | avgY | gap |
|-----|---|---------|------|-----|
| 0.1-0.2 | 42 | 0.180 | 0.286 | -0.105 |
| 0.2-0.3 | 380 | 0.247 | 0.245 | 0.003 |
| 0.3-0.4 | 259 | 0.351 | 0.409 | -0.058 |
| 0.4-0.5 | 362 | 0.459 | 0.478 | -0.019 |
| 0.5-0.6 | 758 | 0.554 | 0.590 | -0.036 |
| 0.6-0.7 | 784 | 0.647 | 0.435 | 0.212 |
| 0.7-0.8 | 107 | 0.722 | 0.308 | 0.413 |
| 0.8-0.9 | 120 | 0.856 | 0.592 | 0.264 |

## Overall verdicts
- v0.2: **FAIL**
- v0.3: **FAIL**

- Production allowlists unchanged. Coach/P0/PR#649 untouched.
