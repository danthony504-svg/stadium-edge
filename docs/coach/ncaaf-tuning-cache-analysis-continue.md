# TUNING cache-only analysis continuation

**Source branch:** `cursor/ncaaf-tuning-closes-3645` (agent `bc-01a1471c-a008-7787-a77d-4ba59e943645`)  
**Resume from:** `ncaaf-tuning-diagnose-baselines.md` + vendored closes archive  
**Generated:** 2026-10-17T01:58Z  
**FINAL_EVAL:** UNTOUCHED · **Gate:** false · **Paid requests:** none · **Deploy/OTA:** none  
**Closes in predictive features:** no (eval join only)

## Artifact recovery

| Artifact | Location | Status here |
|----------|----------|-------------|
| Closes archive 470/471 | `artifacts/api-server/test/fixtures/ncaaf-tuning-2025-w1-7-closing-lines.json` | **Recovered** from closes branch (was absent on `ncaaf-phase-e-restore-8b51`) |
| E2b report | `ncaaf-tuning-2025-w1-7-e2b-report.json` | Recovered |
| Diagnose baselines | `ncaaf-tuning-diagnose-baselines.md` (+ `.json`) | Recovered |
| Expanded cohort research | `ncaaf-tuning-expanded-cohort-research.md` (+ `.json`) | Recovered |
| FINAL_EVAL fixtures | — | **Still absent** (correct) |

Archive meta: creditsSpent **3280** / cap **4500**; matchSource primary 413 + alias rematch 56 + prekick retry 1; still missing **1** (Nebraska vs Houston Christian).

## Same-cohort fair compare (n=421)

Identical eval set for every model: TUNING rows with `closeMlHome`+`closeSpreadHome`, non-tie. Closes used **only** for market Brier / ATS line settlement.

| Model | n | ML Brier | Market | Δ | M3 | ATS | S2 | corr(m) | meanPred/Act |
|-------|--:|---------:|-------:|--:|:--:|----:|:--:|--------:|-------------:|
| `locked_drive_engine` | 421 | 0.2016 | 0.1501 | 0.0515 | false | 0.2943 | false | 0.484 | 8.5/10.7 |
| `margin_history_mean` | 421 | 0.1967 | 0.1501 | 0.0466 | false | 0.2918 | false | 0.524 | 6.0/10.7 |
| `opp_adj_rating` | 421 | 0.1824 | 0.1501 | 0.0324 | false | 0.3122 | false | 0.514 | 3.8/10.7 |
| `opp_adj_rating_time_ordered_slope` | 421 | 0.1828 | 0.1501 | 0.0327 | false | 0.3122 | false | 0.514 | 3.8/10.7 |

**Locked criteria:** M3 = engine ≤ market+0.02 · S2 = ATS Brier < 0.25 — **all FAIL** on this cohort.

## Pregame team-strength inputs

| Check | Result |
|-------|--------|
| Timing | `walkHoldoutGames: form from earlier games only; credible completedAt or kickoff+4h; evaluated game excluded` |
| Future leakage | `none — ratings updated after prediction; form walker is causal` |
| Provenance | {"venue_split": 418, "venue_l10_blend": 2, "last10": 1} |
| Early thin form (w1–3, nForm<3) | 46 |
| FCS opponents in cohort | 45 |
| Locked residual / shrink / gap | 14.5 / 2 / 1 |

## Margin compression mechanism

| Metric | Value |
|--------|------:|
| mean\|raw offense gap\| | 10.27 |
| mean\|teamMean blended\| | 9.44 |
| blended/raw (\|raw\|≥3) | 0.932 (n=358) |
| Score-rate cap bind share | 0.0% (eligible 421) |
| Large-gap ≥14 cap binds | 0 / 98 |

**Conclusion:** primary compressor is `teamMean(for, oppAgainst)` (≈7–8% gap shrink on large gaps; halves when one side dominates), **not** the 0.98 score-rate cap (never binds on this cohort).

## Time-ordered TUNING validation

Note: Opp-adj ratings seeded on 2024 FBS-ish games, updated online after each 2025 prediction. Time-ordered slope refits on prior TUNING rows only.

### By week — locked drive engine

| Week | n | Eng ML | Mkt ML | Δ | ATS | corr(m) | meanPred | meanAct | bias |
|------|--:|-------:|-------:|--:|----:|--------:|---------:|--------:|-----:|
| w1 | 86 | 0.180 | 0.096 | 0.084 | 0.307 | 0.414 | 10.4 | 17.9 | -7.5 |
| w2 | 64 | 0.194 | 0.138 | 0.056 | 0.320 | 0.535 | 10.2 | 15.8 | -5.7 |
| w3 | 59 | 0.181 | 0.141 | 0.040 | 0.303 | 0.557 | 6.8 | 11.4 | -4.6 |
| w4 | 55 | 0.224 | 0.189 | 0.035 | 0.303 | 0.332 | 9.5 | 9.4 | 0.1 |
| w5 | 52 | 0.235 | 0.160 | 0.075 | 0.259 | 0.554 | 6.4 | 2.5 | 3.9 |
| w6 | 49 | 0.196 | 0.169 | 0.027 | 0.279 | 0.521 | 7.0 | 7.2 | -0.2 |
| w7 | 56 | 0.217 | 0.192 | 0.025 | 0.271 | 0.361 | 7.7 | 4.7 | 3.0 |

### By week — opp-adj rating (best ML)

| Week | n | Eng ML | Mkt ML | Δ | ATS | corr(m) | meanPred | meanAct | bias |
|------|--:|-------:|-------:|--:|----:|--------:|---------:|--------:|-----:|
| w1 | 86 | 0.177 | 0.096 | 0.081 | 0.341 | 0.402 | 6.5 | 17.9 | -11.4 |
| w2 | 64 | 0.171 | 0.138 | 0.033 | 0.376 | 0.540 | 5.4 | 15.8 | -10.5 |
| w3 | 59 | 0.176 | 0.141 | 0.035 | 0.322 | 0.635 | 2.5 | 11.4 | -8.9 |
| w4 | 55 | 0.213 | 0.189 | 0.025 | 0.302 | 0.327 | 4.0 | 9.4 | -5.4 |
| w5 | 52 | 0.170 | 0.160 | 0.009 | 0.273 | 0.585 | 1.9 | 2.5 | -0.6 |
| w6 | 49 | 0.184 | 0.169 | 0.015 | 0.283 | 0.643 | 2.8 | 7.2 | -4.5 |
| w7 | 56 | 0.191 | 0.192 | -0.001 | 0.254 | 0.390 | 1.9 | 4.7 | -2.8 |

### By favorite size — locked drive engine

| Bin | n | Eng ML | Mkt ML | Δ | ATS | corr(m) | meanPred | meanAct | bias |
|-----|--:|-------:|-------:|--:|----:|--------:|---------:|--------:|-----:|
| pick_em | 73 | 0.266 | 0.234 | 0.033 | 0.252 | 0.043 | 6.4 | 0.6 | 5.8 |
| small_3.5_7.5 | 106 | 0.260 | 0.227 | 0.033 | 0.271 | 0.200 | 6.4 | 1.6 | 4.8 |
| medium_7.5_14 | 75 | 0.209 | 0.167 | 0.042 | 0.274 | 0.342 | 6.8 | 7.4 | -0.6 |
| large_14plus | 167 | 0.133 | 0.057 | 0.076 | 0.335 | 0.545 | 11.5 | 22.3 | -10.8 |

### By favorite size — opp-adj rating

| Bin | n | Eng ML | Mkt ML | Δ | ATS | corr(m) | meanPred | meanAct | bias |
|-----|--:|-------:|-------:|--:|----:|--------:|---------:|--------:|-----:|
| pick_em | 73 | 0.237 | 0.234 | 0.003 | 0.249 | 0.112 | 0.4 | 0.6 | -0.2 |
| small_3.5_7.5 | 106 | 0.235 | 0.227 | 0.008 | 0.258 | 0.257 | 0.9 | 1.6 | -0.6 |
| medium_7.5_14 | 75 | 0.203 | 0.167 | 0.036 | 0.309 | 0.378 | 1.6 | 7.4 | -5.7 |
| large_14plus | 167 | 0.116 | 0.057 | 0.059 | 0.373 | 0.535 | 8.1 | 22.3 | -14.2 |

**Read:** Week 1 margin bias is worst (pred 10.4 vs act 17.9). Large favorites (14+) keep strong ML but catastrophic ATS (0.33) from compression (pred 11.5 vs act 22.3). Pick'em/small spreads: near-coin ML and ~0 margin corr. Opp-adj improves ML weeks mid-season but does **not** clear M3 any week and worsens ATS vs locked engine overall.

## Continuity from diagnose-baselines

Prior diagnose (n≈420 slices) already showed home-favorite under-confidence, 21+ blowout compression, and engine ≈ logistic(strengthGap). Expanded fair n=421 confirms: best structural ML (`opp_adj_rating`) still Δ≈0.032 vs market; ATS regresses. **Recommend model replacement** (architecture), not residual/gap-scale knobs. Gate stays false.

## Explicit non-actions

- No Odds HTTP / no purchase / no upgrade  
- No FINAL_EVAL load or fixture write  
- No `NCAAF_GAME_LINE_SIM_VALIDATED` flip · no deploy · no OTA  
