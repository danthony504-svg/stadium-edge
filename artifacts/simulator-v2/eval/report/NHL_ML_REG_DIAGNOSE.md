# NHL ml_regulation diagnose (ECE≈0.044 @ n=650)

Shadow-only. Gates unchanged (`maxEce=0.04`, `minOos=500`). Default hockey.joint remains **v0.3**.
Val lever screen uses early-2024 chrono train slice only — **holdout not used for tuning**.

## Holdout evidence (frozen expand)
| Family | n | ECE | Verdict |
|--------|---|-----|---------|
| ml_regulation | 650 | 0.0439 | **FAIL** |
| ml_final | 650 | 0.0313 | **PASS** (preserve) |

Baseline calib: shrink=0.4 shockσ=0.15 hfa=0.08.

## Reliability pattern (holdout v0.3)
From expand report: mean bias≈−0.018 (mild underconfidence); mass in 0.3–0.5 bins nearly calibrated;
ECE driven by thin tail bins + residual sharpness — not a single obvious HFA flip.

## Val-only lever screen
| Lever | n_reg | ECE_reg | Brier | LL | mad½ | n_fin | ECE_fin | reg | fin |
|-------|-------|---------|-------|----|------|-------|---------|-----|-----|
| v0.3_default | 650 | 0.0418 | 0.2419 | 0.6772 | 0.0935 | 650 | 0.0414 | FAIL | FAIL |
| shrink_0.45 | 650 | 0.0363 | 0.2422 | 0.6778 | 0.0879 | 650 | 0.0351 | PASS | PASS |
| shrink_0.50 | 650 | 0.0362 | 0.2408 | 0.6748 | 0.0844 | 650 | 0.0350 | PASS | PASS |
| hfa_0.06 | 650 | 0.0405 | 0.2421 | 0.6776 | 0.0949 | 650 | 0.0386 | FAIL | PASS |
| hfa_0.10 | 650 | 0.0485 | 0.2425 | 0.6785 | 0.0912 | 650 | 0.0422 | FAIL | FAIL |
| shock_0.18 | 650 | 0.0449 | 0.2418 | 0.6768 | 0.0923 | 650 | 0.0344 | FAIL | PASS |
| shock_0.12 | 650 | 0.0425 | 0.2414 | 0.6762 | 0.0944 | 650 | 0.0343 | FAIL | PASS |

## Decision
- Status: **CLEAR_VAL_LEVER → APPLIED**
- Smallest clear lever: **shrink_0.45** (also shrink_0.50 PASS on val). Applied to default `NHL_FORM_SHRINK_TO_LEAGUE`.
- Holdout re-grade after apply: ml_regulation ECE **0.0380 PASS**, ml_final ECE **0.0308 PASS** (preserved vs 0.0313).
- Do **not** loosen gates. Do **not** enable spreads/totals without n≥500.

## Next step
1. Keep v0.3 + shrink 0.45 as shadow default (both ML families PASS on n=650).
2. Props remain FAIL — mapping fixed; λ/usage next.
3. Still no production NHL serve.

## Val reliability (v0.3 default)
| bin | n | avgPred | avgY | gap |
|-----|---|---------|------|-----|
| 0.1-0.2 | 1 | 0.186 | 0.000 | 0.186 |
| 0.2-0.3 | 46 | 0.267 | 0.413 | -0.146 |
| 0.3-0.4 | 192 | 0.357 | 0.344 | 0.013 |
| 0.4-0.5 | 267 | 0.447 | 0.438 | 0.009 |
| 0.5-0.6 | 116 | 0.540 | 0.422 | 0.118 |
| 0.6-0.7 | 28 | 0.628 | 0.571 | 0.057 |

| Family | Verdict | n | games | effN | Brier | LogLoss | ECE | ECE_SE | bias | reasons |
|--------|---------|---|-------|------|-------|---------|-----|--------|------|---------|
| nhl:ml_regulation:val | **FAIL** | 650 | 650 | 650.0 | 0.2419 | 0.6772 | 0.0418 | 0.0152 | 0.021 | ece_0.0418_gt_0.04 |
| nhl:ml_final:val | **FAIL** | 650 | 650 | 650.0 | 0.2492 | 0.6916 | 0.0414 | 0.0149 | -0.013 | ece_0.0414_gt_0.04 |
