# Clean engine — identical-ID compare + ablation protocol (predefined)

**Status:** Experiments predefined **before** looking at ablation outcomes for threshold shopping.  
**Stamp:** `ncaaf-score-margin-v1-research`  
**Rule:** Do **not** retune HFA / σ / LR merely to cross M3/S2. Report metrics; leave params.  
**FINAL_EVAL:** UNTOUCHED · injury validation open · no spend/deploy/OTA/unlock  

## Naming

| Field | Meaning |
|-------|---------|
| `evaluableSupported` | Research inputs complete enough to score (FBS–FBS rated + resolved venue). **Not** production approval. |
| `productionReleaseApproved` | Always **false** on this research stamp. |

The prior name `releaseEligible` is retired for this reason — ~350 TUNING preds are **evaluable**, not release-approved.

## Large-favorite slice reconcile (94 vs 107)

| Convention | Rule on `abs(closeSpreadHome)` | identical-334 n |
|------------|--------------------------------|----------------:|
| **Prior identical-334 / subdivision-fix** | `favSize`: `abs <= 14` → medium; **`abs > 14`** → large | **94** |
| **Clean M3 screen (first pass)** | `abs >= 14` | **107** |
| Difference | Exactly **13** games with `abs == 14` | 107 − 94 |

- **Spread source:** TUNING Odds archive `closeSpreadHome` (American home line).  
- **Favorite definition:** magnitude of close home spread (either side can be favorite).  
- **Pushes:** ATS rows with `homeScore + line - awayScore == 0` excluded (`yAts=null`); ML uses decisive finals only. On identical-334 large (`>14`), push count among ML set is 0 in current archive joins.

**Canonical for head-to-head with prior identical-334 tables:** use **`abs > 14`**. Also report `abs >= 14` as a sensitivity footnote.

## Identical game IDs

Primary cohort = **identical-334** event IDs (fair close-joined ∩ verified FBS–FBS ∩ rated under team-strength after-IDs).  
Venue sidecar applied for clean engine. Prior models: archived per-game preds in `ncaaf-tuning-pipeline-audit-predictions.json` (`locked_drive_teamMean`, `ts_full`) filtered to the same IDs; slice metrics cross-checked against `ncaaf-tuning-identical-334-finish.json`.

## Predefined ablations (predict-time; same chronological updates)

| ID | Change | Hypothesis (Week-1 / 14+) |
|----|--------|---------------------------|
| `A0_full` | Venue HFA + uncertainty σ + opp-adj (current) | Baseline clean |
| `A1_no_hfa` | Force HFA=0 even when venue=home | W1/home bias from HFA? |
| `A2_fixed_sigma` | Uncertainty=0 → base margin/total σ only | Early-week σ inflation helping/hurting? |
| `A3_no_prior_seed` | No 2024 seed; ratings only after first in-season FBS–FBS | W1 errors from thin/unseeded? |

No close-fitted constants. No LR/HFA/σ grid search.

## Time-ordered TUNING folds

For week `k` in `{2,3,4,5,6,7}`: score only week-`k` games after causal updates from all prior kickoffs (same as production walk). Report W1 separately (seed-only / no in-season history).

## Exit

Write metrics + uncertainty (n ML/ATS, Briers, Δ, residual mean/RMSE). **Do not** declare PASS or change locked thresholds.
