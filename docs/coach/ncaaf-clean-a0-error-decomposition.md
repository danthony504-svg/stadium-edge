# A0 freeze — margin vs uncertainty decomposition + next experiment

**Stamp:** `ncaaf-score-margin-v1-research`  
**Generated:** 2026-10-17T11:52:16.496Z  
**Ablation round:** **CLOSED** — frozen candidate **A0_full** (A1/A2/A3 not adopted). **FINAL_EVAL not advanced.**  
**Ops:** NCAAF gate false · injury validation OPEN · production freeze · voice paused · no spend/deploy/OTA

## 1. Ablation round closed

| Item | Decision |
|------|----------|
| Freeze | `A0_full` (venue HFA + uncertainty σ + score opp-adj + 2024 seed) |
| Rejected | A1 no-HFA, A2 fixed-σ (ML↑ ATS↓ shopping), A3 no-seed |
| FINAL_EVAL | **Not started** |

## 2. Error decomposition (identical-334 A0)

Residual = `(home−away) − marginMean`. Uncertainty diagnostics use `Z = residual / marginSd` (expected |Z|≈0.80, E[Z²]≈1 if calibrated).

| Slice | n | mean resid ± SE | RMSE ± bootSE | |pred|−|spread| ± SE | mean σ | mean|Z| ± SE | mean Z² | RMSE/σ | n mismatch≥14 |
|-------|--:|----------------:|--------------:|-------------------------:|-------:|---------------:|--------:|-------:|--------------:|
| identical_334 | 334 | 2.935±0.91 | 16.935±0.69 | -2.974±0.34 | 21.59 | 0.62±0.03 | 0.65 | 0.78 | 47 |
| week1 | 47 | 3.988±2.62 | 18.403±1.66 | -6.318±1.10 | 27.84 | 0.52±0.06 | 0.44 | 0.66 | 7 |
| large_abs_gt14 | 94 | 7.077±1.65 | 17.506±1.20 | -8.880±0.64 | 22.45 | 0.63±0.05 | 0.63 | 0.78 | 6 |
| week1_and_large_gt14 | 16 | 10.922±3.40 | 17.431±3.13 | -14.553±1.57 | 27.84 | 0.47±0.10 | 0.39 | 0.63 | 0 |
| sign_flip_abs_resid_ge14 | 47 | 0.123±4.11 | 28.176±1.38 | -0.325±0.89 | 21.60 | 1.25±0.07 | 1.77 | 1.30 | 47 |

### Reading

- **Location:** Overall / W1 / large all show **positive** mean residual (home margin understated). Large favorites: predicted |margin| compressed vs close line (`meanCompressionVsLine` in JSON priorDiagnostics).
- **Uncertainty:** On W1/large, mean|Z| (0.52 / 0.63) and RMSE/σ (0.66 / 0.78) sit **below** half-normal / 1.0 ⇒ σ is **somewhat wide**, not too tight. Sign-flip mismatches (n=47) are the opposite (mean|Z|≈1.25). A2’s fixed-σ ML↑/ATS↓ is **not** adopted (threshold shopping).
- **Implication:** Dominant actionable signal is **location compression** (large: |pred|−|spread| = −8.88±0.64; |act|≈22.6 ≈ |spread|≈21.6). Next lever = prior/gap scale (E1), not σ retune and not unsupported EPA/QB inputs.

## 3. Data support assessment

| Candidate input | Supported by existing archives? | Notes |
|-----------------|----------------------------------|-------|
| Opponent-adjusted **score/PPG** efficiency | **Yes — already in A0** | `CleanOppAdjStrength` + phase-e 2024 seed (n=871 games) |
| Opponent-adjusted **EPA / success-rate** | **No** | Not on TUNING/phase-e rows |
| Roster / QB continuity (historical pregame) | **No** | `injuryKnown`/`qbOut` non-null on closes: 0/470 / 0/470; E4 open; no TUNING roster fields |
| Forward ESPN injury/QB collector | Forward-only | Cannot re-score 2025 TUNING historically without inventing |

## 4. Proposed bounded experiment (PROPOSAL ONLY — do not implement yet)

### E1 — Prior talent-gap scale (location-only)

| Field | Content |
|-------|---------|
| **Hypothesis** | W1 / large-fav errors are mostly **margin compression** from the 2024 seed + opp-adj PPG ratings, not σ. Scaling the rating gap by a predeclared α∈{1.15, 1.25} (HFA after; uncertainty formula frozen) reduces location bias without ATS regression. |
| **Required inputs** | Existing phase-e 2024 + TUNING + venue sidecar + identical-334 closes (eval-only). **No new data. No QB/EPA.** |
| **Evaluation** | Time-ordered TUNING week folds vs frozen A0; report meanResidual±SE, RMSE±bootSE, mean|Z|±SE, ML Δ±bootSE, ATS Brier±bootSE on overall / W1 / abs>14. |
| **Selection** | Adopt α only if location improves ≥1 SE on W1 **and** large **and** overall ML/ATS do not worsen beyond SE; else keep A0. **No grid expansion after scores. No FINAL_EVAL.** |
| **Explicit non-goals** | No σ retune; no close features; no spend; no gate/OTA/deploy; no injury backfill |

## 5. Uncertainty on metrics

All primary location/σ summaries above include **analytic SE** (mean) and/or **bootstrap SE** (RMSE, Brier when scored in E1). Slice n≈47 (W1) and n≈94 (large) remain thin — treat M3/S2 flags as descriptive only.

Fixture: `artifacts/api-server/test/fixtures/ncaaf-clean-a0-error-decomposition.json`
