# NHL named-player prop mapping audit + OOS re-eval

Shadow-only. No holdout tuning of usage/shock/HFA.
Mapping audit covers goals / assists / points / SOG / saves / alts (+ plusMinus, goalie keys).

## Audit — athlete identity / team side / participation / stat paths
| Check | Result |
|-------|--------|
| Athlete IDs present on box athletes | 4946 rows with non-empty id (verified) |
| Team side home/away | home=2474 away=2472 |
| Skaters / goalies | skaters=4673 goalies=273 |
| TOI parseable (>0) | 4946 |
| Skaters with SOG>0 after fix | 3463 |
| Skaters with assists>0 after fix | 1081 |
| Skaters with points>0 after fix | 1570 |
| Rows with plusMinus parsed | 4673 |
| Legacy SOG key regex `/^(sog\|shots?)$/i` on ESPN keys | index=-1 (**MISS**) |
| Fixed SOG key (includes `shotsTotal`) | index=12 key=`shotsTotal` |
| Assists key | index=11 key=`assists` |
| PlusMinus key | index=3 key=`plusMinus` |
| Goals key | index=9 |
| Label mode SOG (must be `S`, not label `SOG`) | index=12 label=`S` |
| Goalie saves key | index=4 isGoalieGrp=true |

### Mapping fixes
- shotsTotal → skater SOG (was missed by /^(sog|shots?)$/i)
- assists machine key + label A (was unparsed → actual=0)
- points = goals+assists when ESPN omits points column
- plusMinus machine key + label +/- (audit coverage)
- label mode: S→SOG, never label SOG (shootoutGoals)
- goalie: saves key / SV label; goalsAgainst≠goals; shootoutSaves≠saves

### Settlement paths (model)
- goals → `players.{id}.stats.goals`
- assists → `players.{id}.stats.assists`
- points → `players.{id}.stats.points` (actuals = goals+assists from box)
- SOG → `players.{id}.stats.shots_on_goal`
- saves → `players.{id}.stats.saves`

## Before mapping completeness (SOG/assists/points actuals zeroed)
| Slice | n | meanP | meanY | bias | ECE | Brier | LL | actMean | simMean | actZeroRate |
|-------|---|-------|-------|------|-----|-------|----|---------|---------|-------------|
| prop_goals_0.5 | 520 | 0.238 | 0.173 | 0.065 | 0.0703 | 0.1481 | 0.4751 | 0.19 | 0.29 | 0.83 |
| prop_ast_0.5 | 520 | 0.265 | 0.000 | 0.265 | 0.2650 | 0.0708 | 0.3084 | 0.00 | 0.33 | 1.00 |
| prop_pts_0.5 | 520 | 0.419 | 0.000 | 0.419 | 0.4195 | 0.1769 | 0.5453 | 0.00 | 0.62 | 1.00 |
| prop_sog_2.5 | 520 | 0.676 | 0.000 | 0.676 | 0.6761 | 0.4574 | 1.1288 | 0.00 | 3.57 | 1.00 |
| alt_prop_ast_1.5 | 520 | 0.054 | 0.000 | 0.054 | 0.0543 | 0.0030 | 0.0559 | 0.00 | 0.33 | 1.00 |
| alt_prop_pts_1.5 | 520 | 0.144 | 0.000 | 0.144 | 0.1444 | 0.0212 | 0.1562 | 0.00 | 0.62 | 1.00 |
| alt_prop_sog_3.5 | 520 | 0.485 | 0.000 | 0.485 | 0.4853 | 0.2359 | 0.6650 | 0.00 | 3.57 | 1.00 |
| prop_saves_24.5 | 259 | 0.854 | 0.529 | 0.325 | 0.3249 | 0.3538 | 0.9871 | 25.19 | 31.01 | 0.00 |

Named-prop gate (broken): **FAIL** n=3899 ECE=0.3030 bias=0.303

### Per-family (broken)
| Family | Verdict | n | games | effN | Brier | LogLoss | ECE | ECE_SE | bias | reasons |
|--------|---------|---|-------|------|-------|---------|-----|--------|------|---------|
| nhl:prop_goals | **FAIL** | 520 | 130 | 130.0 | 0.1481 | 0.4751 | 0.0703 | 0.0147 | 0.065 | ece_0.0703_gt_0.04 |
| nhl:prop_assists | **FAIL** | 520 | 130 | 130.0 | 0.0708 | 0.3084 | 0.2650 | 0.0013 | 0.265 | ece_0.2650_gt_0.04 |
| nhl:prop_points | **FAIL** | 520 | 130 | 130.0 | 0.1769 | 0.5453 | 0.4195 | 0.0016 | 0.419 | ece_0.4195_gt_0.04 |
| nhl:prop_sog | **FAIL** | 520 | 130 | 130.0 | 0.4574 | 1.1288 | 0.6761 | 0.0008 | 0.676 | ece_0.6761_gt_0.04 |
| nhl:prop_saves | **INSUFFICIENT_DATA** | 259 | 130 | 129.8 | 0.3538 | 0.9871 | 0.3249 | 0.0298 | 0.325 | oos_sample_259_lt_500; ece_0.3249_gt_0.04 |
| nhl:prop_alts | **FAIL** | 1560 | 130 | 130.0 | 0.0867 | 0.2924 | 0.2280 | 0.0008 | 0.228 | ece_0.2280_gt_0.04 |

## After mapping fixes (full named-player OOS)
| Slice | n | meanP | meanY | bias | ECE | Brier | LL | actMean | simMean | actZeroRate |
|-------|---|-------|-------|------|-----|-------|----|---------|---------|-------------|
| prop_goals_0.5 | 520 | 0.238 | 0.173 | 0.065 | 0.0703 | 0.1481 | 0.4751 | 0.19 | 0.29 | 0.83 |
| prop_ast_0.5 | 520 | 0.265 | 0.227 | 0.038 | 0.0412 | 0.1782 | 0.5427 | 0.26 | 0.33 | 0.77 |
| prop_pts_0.5 | 520 | 0.419 | 0.358 | 0.062 | 0.0773 | 0.2360 | 0.6651 | 0.46 | 0.62 | 0.64 |
| prop_sog_2.5 | 520 | 0.676 | 0.256 | 0.420 | 0.4203 | 0.3681 | 0.9419 | 1.69 | 3.57 | 0.23 |
| alt_prop_ast_1.5 | 520 | 0.054 | 0.029 | 0.026 | 0.0255 | 0.0286 | 0.1371 | 0.26 | 0.33 | 0.77 |
| alt_prop_pts_1.5 | 520 | 0.144 | 0.081 | 0.064 | 0.0637 | 0.0793 | 0.3030 | 0.46 | 0.62 | 0.64 |
| alt_prop_sog_3.5 | 520 | 0.485 | 0.115 | 0.370 | 0.3699 | 0.2394 | 0.6720 | 1.69 | 3.57 | 0.23 |
| prop_saves_24.5 | 259 | 0.854 | 0.529 | 0.325 | 0.3249 | 0.3538 | 0.9871 | 25.19 | 31.01 | 0.00 |

### Per-family (fixed) — ECE / Brier / LL / n
| Family | Verdict | n | games | effN | Brier | LogLoss | ECE | ECE_SE | bias | reasons |
|--------|---------|---|-------|------|-------|---------|-----|--------|------|---------|
| nhl:prop_goals | **FAIL** | 520 | 130 | 130.0 | 0.1481 | 0.4751 | 0.0703 | 0.0147 | 0.065 | ece_0.0703_gt_0.04 |
| nhl:prop_assists | **FAIL** | 520 | 130 | 130.0 | 0.1782 | 0.5427 | 0.0412 | 0.0183 | 0.038 | ece_0.0412_gt_0.04 |
| nhl:prop_points | **FAIL** | 520 | 130 | 130.0 | 0.2360 | 0.6651 | 0.0773 | 0.0196 | 0.062 | ece_0.0773_gt_0.04 |
| nhl:prop_sog | **FAIL** | 520 | 130 | 130.0 | 0.3681 | 0.9419 | 0.4203 | 0.0205 | 0.420 | ece_0.4203_gt_0.04 |
| nhl:prop_saves | **INSUFFICIENT_DATA** | 259 | 130 | 129.8 | 0.3538 | 0.9871 | 0.3249 | 0.0298 | 0.325 | oos_sample_259_lt_500; ece_0.3249_gt_0.04 |
| nhl:prop_alts | **FAIL** | 1560 | 130 | 130.0 | 0.1158 | 0.3707 | 0.1530 | 0.0078 | 0.153 | ece_0.1530_gt_0.04 |

### Aggregate named-player gate
| Family | Verdict | n | games | effN | Brier | LogLoss | ECE | ECE_SE | bias | reasons |
|--------|---------|---|-------|------|-------|---------|-----|--------|------|---------|
| nhl:player_prop_named | **FAIL** | 3899 | 130 | 130.0 | 0.1939 | 0.5640 | 0.1609 | 0.0087 | 0.161 | ece_0.1609_gt_0.04 |

## Reliability (fixed named props)
| bin | n | avgPred | avgY | gap |
|-----|---|---------|------|-----|
| 0.0-0.1 | 522 | 0.055 | 0.029 | 0.026 |
| 0.1-0.2 | 531 | 0.146 | 0.089 | 0.057 |
| 0.2-0.3 | 975 | 0.249 | 0.198 | 0.052 |
| 0.3-0.4 | 193 | 0.363 | 0.352 | 0.010 |
| 0.4-0.5 | 780 | 0.456 | 0.222 | 0.234 |
| 0.5-0.6 | 119 | 0.514 | 0.126 | 0.388 |
| 0.6-0.7 | 474 | 0.673 | 0.262 | 0.411 |
| 0.7-0.8 | 46 | 0.708 | 0.196 | 0.513 |
| 0.8-0.9 | 259 | 0.854 | 0.529 | 0.325 |

## Decision
- Mapping audit complete; fixes listed above in `eval/nhlEspnShared.ts`.
- Aggregate named-player props: **FAIL** n=3899 ECE=0.1609 (gate maxEce=0.04, minOos=500).
- Residual FAIL (when present) is **model** λ/usage vs boxscore, not identity/side/path miss.
- Do **not** enable NHL player_prop allowlist. No holdout parameter tuning performed.

Games diagnosed: 130; broken obs=3899; fixed obs=3899.

See also: `MILESTONE_NHL_DECISION.md`, `NHL_COVERAGE_MATRIX.md`.
