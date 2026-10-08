# NHL named-player prop diagnose (ECE≈0.393)

Shadow-only. No holdout tuning of usage/shock/HFA. Smallest clear fix: ESPN SOG column mapping.

## Audit — athlete identity / team side / participation / stat paths
| Check | Result |
|-------|--------|
| Athlete IDs present on box athletes | 2281 rows with non-empty id (verified) |
| Team side home/away | home=1141 away=1140 |
| Skaters / goalies | skaters=2157 goalies=124 |
| TOI parseable (>0) | 2281 |
| Skaters with SOG>0 after fix | 1602 |
| Legacy SOG key regex `/^(sog\|shots?)$/i` on ESPN keys | index=-1 (**MISS**) |
| Fixed SOG key (includes `shotsTotal`) | index=12 key=`shotsTotal` |
| Goals key | index=9 |
| Goalie saves key | index=4 isGoalieGrp=true |

### Settlement paths (model)
- goals → `players.{id}.stats.goals`
- SOG → `players.{id}.stats.shots_on_goal`
- saves → `players.{id}.stats.saves`
- Eval y labels come from ESPN box columns; mismatch on SOG zeros all skater SOG actuals.

## Root cause
**Primary: wrong settlement actuals for SOG props.**

ESPN NHL skater boxscore exposes shots as `shotsTotal`, not `sog` / bare `shots`.
Legacy eval parser used `/^(sog|shots?)$/i` → always missed → **actual SOG = 0 for every skater**.
Sim still samples SOG ~ Poisson(2.8 + teamG·usage·1.1) ≈ mean 3–4 → P(over 2.5) / P(over 3.5) high.
With ~480/840 named-prop obs being SOG / alt-SOG, bias≈mean(p)−0 ≈ **0.39** matches reported ECE≈0.393.

Not primarily wrong athlete identity (IDs verified) or team-side flip.
Secondary contributors (not holdout-tuned here): uniform usage=0.28; first-N skater selection historically one-team-biased; backup goalie saves vs starter λ.

## Sim mean/var vs actual (v0.3) — broken SOG path (legacy)
| Slice | n | meanP | meanY | bias | ECE | actMean | simMean | actVar | simMeanVar | actZeroRate | p≥0.8 |
|-------|---|-------|-------|------|-----|---------|---------|--------|------------|-------------|-------|
| prop_goals_0.5 | 240 | 0.242 | 0.171 | 0.071 | 0.0747 | 0.19 | 0.29 | 0.19 | 0.00 | 0.83 | 0.00 |
| prop_sog_2.5 | 240 | 0.678 | 0.000 | 0.678 | 0.6780 | 0.00 | 3.58 | 0.00 | 0.01 | 1.00 | 0.00 |
| alt_prop_sog_3.5 | 240 | 0.488 | 0.000 | 0.488 | 0.4882 | 0.00 | 3.58 | 0.00 | 0.01 | 1.00 | 0.00 |
| prop_saves_24.5 | 120 | 0.855 | 0.558 | 0.297 | 0.2969 | 25.73 | 31.05 | 50.85 | 0.24 | 0.00 | 1.00 |

Named-prop gate (broken): **FAIL** n=840 ECE=0.3969 bias=0.396

## After smallest fix (`shotsTotal` SOG mapping + balanced side selection)
| Slice | n | meanP | meanY | bias | ECE | actMean | simMean | actVar | simMeanVar | actZeroRate | p≥0.8 |
|-------|---|-------|-------|------|-----|---------|---------|--------|------------|-------------|-------|
| prop_goals_0.5 | 240 | 0.242 | 0.171 | 0.071 | 0.0747 | 0.19 | 0.29 | 0.19 | 0.00 | 0.83 | 0.00 |
| prop_sog_2.5 | 240 | 0.678 | 0.275 | 0.403 | 0.4030 | 1.77 | 3.58 | 2.18 | 0.01 | 0.22 | 0.00 |
| alt_prop_sog_3.5 | 240 | 0.488 | 0.125 | 0.363 | 0.3632 | 1.77 | 3.58 | 2.18 | 0.01 | 0.22 | 0.00 |
| prop_saves_24.5 | 120 | 0.855 | 0.558 | 0.297 | 0.2969 | 25.73 | 31.05 | 50.85 | 0.24 | 0.00 | 1.00 |

| Family | Verdict | n | games | effN | Brier | LogLoss | ECE | ECE_SE | bias | reasons |
|--------|---------|---|-------|------|-------|---------|-----|--------|------|---------|
| nhl:player_prop_named | **FAIL** | 840 | 60 | 60.0 | 0.2625 | 0.7288 | 0.2826 | 0.0156 | 0.282 | ece_0.2826_gt_0.04 |

## Reliability (fixed named props)
| bin | n | avgPred | avgY | gap |
|-----|---|---------|------|-----|
| 0.1-0.2 | 8 | 0.192 | 0.250 | -0.058 |
| 0.2-0.3 | 230 | 0.243 | 0.170 | 0.073 |
| 0.3-0.4 | 2 | 0.306 | 0.000 | 0.306 |
| 0.4-0.5 | 172 | 0.478 | 0.128 | 0.350 |
| 0.5-0.6 | 68 | 0.514 | 0.118 | 0.397 |
| 0.6-0.7 | 217 | 0.675 | 0.276 | 0.398 |
| 0.7-0.8 | 23 | 0.708 | 0.261 | 0.448 |
| 0.8-0.9 | 120 | 0.855 | 0.558 | 0.297 |

## Decision
- Root cause: **boxscore_sog_path_miss_shotsTotal**
- Smallest fix applied in `eval/nhlEspnShared.ts` (`boxStatIndices` includes `shotsTotal`).
- Named-player props remain **FAIL** (post-fix ECE≈0.283): residual **model** SOG/saves overconfidence (sim mean ≫ boxscore), not identity/side.
- Blocker: role/TOI usage + SOG/saves λ recalibration on train/val only — **no holdout tuning** on this freeze.
- Do **not** enable NHL player_prop allowlist.

Games diagnosed: 60; broken obs=840; fixed obs=840.

See also: `MILESTONE_NHL_DECISION.md`.
