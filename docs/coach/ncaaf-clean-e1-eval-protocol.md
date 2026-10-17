# E1 evaluation protocol — FROZEN before execution

**Status:** RULES LOCKED · research-only · **do not edit after seeing E1 scores**  
**Stamp:** `ncaaf-score-margin-v1-research`  
**Baseline:** frozen **A0_full**  
**Variants:** exactly **α ∈ {1.15, 1.25}** — **no grid expansion** after scores  
**Date locked:** 2026-10-17 (pre-execution)  
**FINAL_EVAL:** UNTOUCHED · NCAAF gate false · injury validation OPEN · production freeze · voice paused · no spend/deploy/OTA

## 1. Lever (implementation contract)

| Item | Rule |
|------|------|
| Gap scale | Let `ratingGap` = predicted home−away margin **from ratings with HFA=0**. Set `marginMean = α × ratingGap + hfaPoints`. |
| HFA | Unchanged placement: `hfaPoints = CLEAN_HFA_POINTS` iff `venue.kind==="home"`, else 0. Applied **after** α. |
| σ / uncertainty | **Unchanged** — `cleanUncertainty` + `cleanMarginSd` / `cleanTotalSd` identical to A0. |
| Totals | Keep `totalMean` from A0 path; redistribute home/away means to match new margin. |
| Strength updates | Identical chronological walk / LR / seed as A0 (α is predict-time only). |
| Closes | Eval-only — never features. |

## 2. Cohort & folds

| Item | Definition |
|------|------------|
| Primary cohort | **identical-334** (fair close-joined ∩ verified FBS–FBS ∩ rated; same IDs as A0 compare) |
| Large favorite | **`abs(closeSpreadHome) > 14`** (canonical; not ≥14) |
| Week-1 | `week === 1` within identical-334 |
| Walk | Single chronological TUNING 2025 w1–7 walk; score each game after causal updates from prior kickoffs |
| Week folds | Report W1…W7 slices for transparency; adoption uses overall + W1 + large only |

## 3. Location metrics (explicit)

Residual: `r = (homeFg − awayFg) − marginMean`.

| ID | Slice | Metric | Direction of “improve” |
|----|-------|--------|-------------------------|
| **L_W1** | Week-1 identical | `meanResidual` | Decrease toward 0 from A0’s positive bias: `Δ = meanRes_A0 − meanRes_α` must be **≥ +1 × SE_paired(Δ)** (α less positively biased). |
| **L_LG** | Large abs>14 | `meanCompressionVsLine = mean( abs(closeSpreadHome) − abs(marginMean) )` | Decrease compression: `Δ = comp_A0 − comp_α` must be **≥ +1 × SE_paired(Δ)**. |

Secondary (report only, not in adoption gate): `rmseResidual`, `meanPredAbsMinusSpread`, `mean|Z|`, RMSE/σ.

## 4. Overall ML / ATS metrics (screen, not locked criteria)

| ID | Metric | “Do not worsen beyond SE” |
|----|--------|---------------------------|
| **M_ALL** | ML Brier − market Brier (`Δ_mkt`) on identical-334 | `Δ_mkt_α − Δ_mkt_A0 ≤ +1 × SE_paired` (α not worse by >1 SE) |
| **S_ALL** | ATS Brier on identical-334 (pushes excluded) | `ats_α − ats_A0 ≤ +1 × SE_paired` |

**Important:** These are **E1 research-screen** gates only. They do **not** replace locked **M3/S2**, injury validation (E4), human final review, or FINAL_EVAL acceptance.

## 5. Paired uncertainty

- Align A0 and α on the **same event IDs** within each slice.
- For scalar means: paired difference per game, then `SE = sd(diffs)/√n`.
- For Brier / RMSE: **bootstrap** paired resample of event IDs (B=400), SE = sd of bootstrap differences.
- Report point estimate ± SE for every adoption-relevant Δ.

## 6. Adoption rule (further research only)

For a given α, **PASS_RESEARCH** iff **all** hold:

1. **L_W1** improves ≥ 1 SE_paired  
2. **L_LG** improves ≥ 1 SE_paired  
3. **M_ALL** does not worsen beyond 1 SE_paired  
4. **S_ALL** does not worsen beyond 1 SE_paired  

| Outcome | Action |
|---------|--------|
| Exactly one α PASS_RESEARCH | May continue **research** on that α only (still not production; still not FINAL_EVAL) |
| Both PASS_RESEARCH | Prefer smaller \|overall metric regression\|; still research-only |
| **Neither** | **CLOSE E1** — keep A0. **No** further α / scalar sweep |

PASS_RESEARCH ≠ M3/S2 pass ≠ release ≠ injury validation complete.

## 7. Report requirements

- Every variant: A0, α=1.15, α=1.25  
- Every adoption slice: overall / W1 / large — pass/fail per clause with Δ±SE  
- Week folds W1–W7 for transparency  
- Failed slices listed explicitly  
- If neither α passes → document **E1 CLOSED**

## 8. Explicit non-actions

- No α outside {1.15, 1.25}  
- No σ / HFA / LR retune  
- No FINAL_EVAL build  
- No NCAAF unlock / deploy / OTA / spend  
- No editing this protocol after scores
