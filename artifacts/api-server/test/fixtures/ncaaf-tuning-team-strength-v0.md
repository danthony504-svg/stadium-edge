# TUNING: team-strength v0 vs locked drive (cache-only)

**Stamp:** `ncaaf-team-strength-v0-research` · **Flag:** `NCAAF_TEAM_STRENGTH_RESEARCH=1` · **FINAL_EVAL:** untouched · **Gate:** false · **Paid:** none · **Closes in features:** no

## Data limitations

- **fcsDivisionIds:** MISSING — name-heuristic only (no ESPN group/conference IDs on fixtures)
- **injuryPreKick:** MISSING — injuryKnown left null; E4 blocked
- **neutralSiteConference:** MISSING — not on TUNING game rows
- **closingTotalsAlts:** MISSING — not in archive; out of scope
- **finalEval:** UNTOUCHED — not loaded
- **closesInFeatures:** false

## Fair cohort n=421

| Model | n | ML Brier | Δ vs mkt | M3 | ATS | S2 | corr(m) | bias | meanσ |
|-------|--:|---------:|---------:|:--:|----:|:--:|--------:|-----:|------:|
| `locked_drive_teamMean` | 421 | 0.2021 | 0.0520 | false | 0.2936 | false | 0.484 | -2.2 | — |
| `ts_opp_adj_only` | 421 | 0.1820 | 0.0319 | false | 0.3023 | false | 0.526 | -6.8 | 16.5 |
| `ts_opp_adj_early_blend` | 421 | 0.1825 | 0.0325 | false | 0.3021 | false | 0.522 | -6.7 | 16.5 |
| `ts_opp_adj_uncertainty` | 421 | 0.1886 | 0.0385 | false | 0.2852 | false | 0.522 | -6.7 | 20.8 |
| `ts_full` | 421 | 0.1926 | 0.0425 | false | 0.2787 | false | 0.522 | -6.7 | 21.1 |

## Week 1

| Model | n | ML | Δ | ATS | bias | meanσ |
|-------|--:|---:|--:|----:|-----:|------:|
| `locked_drive_teamMean` | 86 | 0.178 | 0.082 | 0.307 | -7.5 | — |
| `ts_opp_adj_only` | 86 | 0.175 | 0.079 | 0.328 | -11.1 | 16.5 |
| `ts_opp_adj_early_blend` | 86 | 0.175 | 0.079 | 0.329 | -11.0 | 16.5 |
| `ts_opp_adj_uncertainty` | 86 | 0.189 | 0.093 | 0.293 | -11.0 | 26.7 |
| `ts_full` | 86 | 0.195 | 0.099 | 0.284 | -11.0 | 27.1 |

## Large favorites (14+)

| Model | n | ML | Δ | ATS | bias | meanσ |
|-------|--:|---:|--:|----:|-----:|------:|
| `locked_drive_teamMean` | 167 | 0.135 | 0.077 | 0.335 | -10.8 | — |
| `ts_opp_adj_only` | 167 | 0.116 | 0.059 | 0.356 | -14.0 | 16.5 |
| `ts_opp_adj_early_blend` | 167 | 0.119 | 0.062 | 0.360 | -14.2 | 16.5 |
| `ts_opp_adj_uncertainty` | 167 | 0.136 | 0.078 | 0.327 | -14.2 | 22.3 |
| `ts_full` | 167 | 0.144 | 0.087 | 0.313 | -14.2 | 22.9 |

## Vs locked drive baseline

### `ts_opp_adj_only`
- REJECT — aggregate gain with W1/14+ regression
- ΔML vs baseline: -0.0201 · ΔATS: 0.0088 · sliceRegress: true

### `ts_opp_adj_early_blend`
- REJECT — aggregate gain with W1/14+ regression
- ΔML vs baseline: -0.0195 · ΔATS: 0.0085 · sliceRegress: true

### `ts_opp_adj_uncertainty`
- REJECT — aggregate gain with W1/14+ regression
- ΔML vs baseline: -0.0135 · ΔATS: -0.0083 · sliceRegress: true

### `ts_full`
- REJECT — aggregate gain with W1/14+ regression
- ΔML vs baseline: -0.0094 · ΔATS: -0.0149 · sliceRegress: true

## Conclusion

- Any M3∧S2 PASS: **false**
- Any accept vs baseline (incl. M3∧S2): **false**
- Gate flip: **false** · FINAL_EVAL: **UNTOUCHED** · voice paused · no deploy/OTA

## Repro
```bash
cd artifacts/api-server
NCAAF_TUNING_SIMS=1000 NCAAF_TEAM_STRENGTH_RESEARCH=1 node --import ./test/register-hooks.mjs ./scripts/ncaafTuningTeamStrengthV0.ts
```