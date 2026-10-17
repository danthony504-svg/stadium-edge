# TUNING isolated levers (cache-only)

**FINAL_EVAL:** untouched · **Gate:** false · **Paid:** none · **Closes in features:** no

## Credit provenance (3560 vs 3280)

| Figure | Value | Meaning |
|-------|------:|---------|
| Session remaining-Δ | **3560** | Authoritative Odds spend this retrieval session |
| Script `creditsSpent` | **3280** | `already_spent=20` + `163×20` HTTP in completed process |
| Gap | **280** | Interrupted first process charged cache; second process reused (ledger miss) |
| Retrieval agent | `bc-01a1471c-a008-7787-a77d-4ba59e943645` | branch `cursor/ncaaf-tuning-closes-3645` |
| Distinct retrievals? | **No** | One authorized TUNING pull; two processes |

## Fair cohort n=421

| Model | ML Brier | Δ vs mkt | M3 | ATS | S2 | corr(m) | bias |
|-------|---------:|---------:|:--:|----:|:--:|--------:|-----:|
| `locked_teamMean` | 0.2018 | 0.0517 | false | 0.2931 | false | 0.484 | -2.2 |
| `raw_offense_no_teamMean` | 0.2077 | 0.0576 | false | 0.3040 | false | 0.407 | -2.1 |
| `prior_season_into_w1` | 0.2050 | 0.0549 | false | 0.2973 | false | 0.464 | -2.9 |
| `opp_adj_seed_frozen` | 0.1929 | 0.0428 | false | 0.3205 | false | 0.478 | -6.6 |
| `opp_adj_online_updates` | 0.1819 | 0.0318 | false | 0.3109 | false | 0.526 | -6.8 |

## Week 1 slice

| Model | n | ML | Δ | ATS | bias |
|-------|--:|---:|--:|----:|-----:|
| `locked_teamMean` | 86 | 0.181 | 0.085 | 0.304 | -7.5 |
| `raw_offense_no_teamMean` | 86 | 0.190 | 0.094 | 0.324 | -6.8 |
| `prior_season_into_w1` | 86 | 0.196 | 0.100 | 0.325 | -11.0 |
| `opp_adj_seed_frozen` | 86 | 0.175 | 0.079 | 0.340 | -11.0 |
| `opp_adj_online_updates` | 86 | 0.175 | 0.079 | 0.339 | -11.1 |

## Large favorites (14+)

| Model | n | ML | Δ | ATS | bias |
|-------|--:|---:|--:|----:|-----:|
| `locked_teamMean` | 167 | 0.133 | 0.076 | 0.334 | -10.8 |
| `raw_offense_no_teamMean` | 167 | 0.140 | 0.083 | 0.348 | -10.4 |
| `prior_season_into_w1` | 167 | 0.146 | 0.088 | 0.346 | -12.1 |
| `opp_adj_seed_frozen` | 167 | 0.127 | 0.070 | 0.382 | -14.7 |
| `opp_adj_online_updates` | 167 | 0.116 | 0.058 | 0.371 | -14.0 |

## Slice-aware verdicts vs `locked_teamMean`

### `raw_offense_no_teamMean` → **REJECT**
- w1 ML Brier worsened 0.181→0.190
- w1 Δ vs market worsened 0.085→0.094
- w1–3 ML Brier worsened 0.185→0.193
- large_14plus ATS worsened 0.334→0.348
- no aggregate ML/ATS improvement vs locked_teamMean

### `prior_season_into_w1` → **REJECT**
- w1 ML Brier worsened 0.181→0.196
- w1 Δ vs market worsened 0.085→0.100
- w1 marginBias more under-predictive -7.47→-11.02
- w1–3 ML Brier worsened 0.185→0.191
- large_14plus ATS worsened 0.334→0.346
- large_14plus marginBias more under-predictive -10.82→-12.09
- no aggregate ML/ATS improvement vs locked_teamMean

### `opp_adj_seed_frozen` → **REJECT**
- REJECT: aggregate gain with early-week/large-fav slice regression
- w1 marginBias more under-predictive -7.47→-11.02
- large_14plus ATS worsened 0.334→0.382
- large_14plus marginBias more under-predictive -10.82→-14.70

### `opp_adj_online_updates` → **REJECT**
- REJECT: aggregate gain with early-week/large-fav slice regression
- w1 marginBias more under-predictive -7.47→-11.05
- large_14plus ATS worsened 0.334→0.371
- large_14plus marginBias more under-predictive -10.82→-14.02

## Expanding time-ordered folds (ML Brier)

| Through week | locked | raw | priorW1 | opp frozen | opp online |
|-------------:|-------:|----:|--------:|-----------:|-----------:|
| 1 | 0.181 | 0.190 | 0.196 | 0.175 | 0.175 |
| 2 | 0.186 | 0.196 | 0.195 | 0.176 | 0.174 |
| 3 | 0.185 | 0.193 | 0.191 | 0.179 | 0.174 |
| 4 | 0.193 | 0.198 | 0.198 | 0.188 | 0.182 |
| 5 | 0.199 | 0.203 | 0.203 | 0.187 | 0.180 |
| 6 | 0.199 | 0.204 | 0.203 | 0.191 | 0.181 |
| 7 | 0.202 | 0.208 | 0.205 | 0.193 | 0.182 |

## Conclusion

- Any lever accepted: **false**
- Recommend model replacement: **true** (architecture), not residual/gap scalar
- Gate flip: **false** · FINAL_EVAL: **UNTOUCHED** · paid this turn: **0**

## Repro
```bash
cd artifacts/api-server
NCAAF_TUNING_SIMS=1000 node --import ./test/register-hooks.mjs ./scripts/ncaafTuningIsolatedLevers.ts
```