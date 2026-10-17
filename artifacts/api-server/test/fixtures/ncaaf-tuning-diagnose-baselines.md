# TUNING diagnosis + baselines (closes eval-only)

**FINAL_EVAL:** untouched · **Gate:** `NCAAF_GAME_LINE_SIM_VALIDATED=false` · **Paid retrieval:** none · **Closes in features:** no

## 1. Unmatched 58 — coverage bias audit

| Class | Count |
|-------|------:|
| Recovered via cache alias rematch / pre-kick retry (no paid HTTP) | **57** |
| Still missing | **1** |

**Systematic, not random:** ESPN↔Odds school aliases (`App State`≠`Appalachian State`, `San José`≠`San Jose`, `Southern Miss`≠`Southern Mississippi`, `UMass`≠`Massachusetts`, `Sam Houston`≠`Sam Houston State`, `LIU`/`SE Louisiana` variants) plus FCS opponents absent from Odds FBS boards. One kickoff-bucket slate dropout (Rutgers/Miami OH) was recovered from a cached pre-commence snap.

Still missing after rematch:
- Nebraska vs Houston Christian — FCS opponent / non-board

Rematched closes are vendored into `ncaaf-tuning-2025-w1-7-closing-lines.json` (`matchSource: cache_alias_rematch` / `cache_prekicking_retry`).

## 2. Locked-baseline error slices (n=420, closes eval-only)

### Favorite / underdog
| Side | n | Engine Brier | Market Brier | meanP | meanY | meanMarketP | meanPredMarg | meanActMarg | ATS Brier |
|------|--:|-------------:|-------------:|------:|------:|------------:|-------------:|------------:|----------:|
| Home favorite | 289 | 0.176 | 0.121 | 0.664 | 0.841 | 0.831 | 11.1 | 18.6 | 0.303 |
| Away favorite | 131 | 0.258 | 0.215 | 0.515 | 0.328 | 0.327 | 2.8 | -6.8 | 0.270 |

**Read:** Home favorites under-confident (0.66 vs 0.84). Away-favorite games: engine still ~0.51 home while market/outcomes ~0.33 — home bias + compressed dog side.

### Spread size
| |Bin| n | Eng Brier | Mkt Brier | meanPred | meanAct | marginBias | ATS Brier |
|--|--|--:|----------:|----------:|---------:|--------:|-----------:|----------:|
| |0_3.5| 86 | 0.263 | 0.232 | 6.4 | -0.3 | 6.7 | 0.254 |
| |3.5_7.5| 93 | 0.260 | 0.228 | 6.4 | 2.5 | 3.9 | 0.269 |
| |7.5_14| 75 | 0.210 | 0.167 | 6.8 | 7.4 | -0.6 | 0.276 |
| |14_21| 68 | 0.181 | 0.113 | 8.3 | 10.3 | -2.0 | 0.258 |
| |21plus| 98 | 0.100 | 0.019 | 13.9 | 30.7 | -16.8 | 0.384 |

**Read:** Blowouts (21+) have the worst compression (pred 13.9 vs act 30.7) and worst ATS Brier (0.38). Small spreads over-predict home margin.

### Team strength (|form gap| quintiles)
Weak-gap quintiles have ~coin ML Brier and ~0 corr(gap, Y). Strong-gap quintiles improve ML Brier but still under-predict margin magnitude (q5 pred 18.9 vs act 27.6).

### Season week
Week 1 shows largest margin compression (pred 10.4 vs act 17.9) and largest market gap; mid-season weeks are closer on mean margin but ML Brier stays above market.

## 3. Simple baselines vs engine (no closes in features)

| Model | ML Brier |
|-------|---------:|
| Market close (eval only) | 0.1504 |
| Logistic(strengthGap), slope=0.1 fit on TUNING | 0.1976 |
| Linear `0.5 + gap/60` | 0.1993 |
| **Locked drive engine** | **0.2014** |

Engine ≈ simple logistic on the same strength gap (0.201 vs 0.198). Drive sim is not adding ML discrimination beyond the mean gap.

## 4. Why projected margins lack discrimination

- corr(pred, actual) ≈ **0.488** (rank signal exists)
- meanPred **8.53** vs meanAct **10.64** (~20% compression)
- `gap_scale=1.45` **REFERENCE ONLY**: meanPred rises to ~12.4 but **corr unchanged** at 0.488 — scalar rescale, not a structural fix

## 5. Evidence-backed TUNING levers (not residual widen / not scalar-to-pass)

| Lever | Structural? | ML Brier | Δ vs market | ATS Brier | corr(margin) | meanPred/Act | M3 | S2 |
|-------|:-----------:|---------:|------------:|----------:|-------------:|-------------:|:--:|:--:|
| locked_baseline | False | 0.2014 | 0.0510 | 0.2930 | 0.488 | 8.5/10.6 | False | False |
| prior_season_anchor_0.35 | True | 0.2023 | 0.0519 | 0.2941 | 0.519 | 6.5/10.6 | False | False |
| season_to_date_means | True | 0.2155 | 0.0650 | 0.3083 | 0.567 | 2.9/10.6 | False | False |
| sos_adjusted_offense | True | 0.2400 | 0.0896 | 0.3311 | 0.154 | 3.6/10.6 | False | False |
| margin_history_mean | True | 0.1982 | 0.0478 | 0.2905 | 0.515 | 6.2/10.6 | False | False |
| gap_scale_1.45 (REF ONLY) | False | 0.2065 | 0.0561 | 0.2866 | 0.488 | 12.4/10.6 | False | False |

### Before / after (best structural: `margin_history_mean`)

| | Before (locked) | After |
|--|----------------:|------:|
| n | 420 | 420 |
| ML Brier | 0.2014 | 0.1982 |
| Market Brier | 0.1504 | 0.1504 |
| M3 | False | False |
| ATS Brier | 0.2930 | 0.2905 |
| S2 | False | False |
| corr(margin) | 0.488 | 0.515 |

**Verdict:** `margin_history_mean` (blend current form gap with 2024 prior margin differentials) is the only structural lever that improves both ML Brier and margin corr without being a pure scale knob. Gains are small; **M3 and S2 still FAIL**. Do not lock or flip the gate. `gap_scale` rejected as the proposed change (corr flat).

## Repro

```bash
cd artifacts/api-server
NCAAF_TUNING_SIMS=1500 node --import ./test/register-hooks.mjs ./scripts/ncaafTuningDiagnoseAndBaselines.ts
```

Seed: `FOOTBALL_CALIBRATION_PRIMARY_SEED`. Closes join is post-sim only.
