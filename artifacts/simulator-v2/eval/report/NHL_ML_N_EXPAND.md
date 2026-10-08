# NHL ML n-expand — chrono holdout (ML families only)

Shadow-only. Denser ESPN date sample (daily) + seasons 2022–2024 for form priors.
Holdout protocol unchanged: mid+late-2024 chrono slice; **no holdout tuning**.

## Fetch / freeze
- Seasons fetched: 2022 n=1452, 2023 n=2749, 2024 n=2752
- Date stride: every day (stepDays=1) + week fallback 1–28
- Train reference: 2023 (n=2749); val early-2024 (n=1513)
- Holdout pool mid+late-2024: 1239; graded cap 650
- Form-ready graded: v0.2=650, v0.3=650
- Gate thresholds unchanged: minOos=500, maxEce=0.04

## ML family results (v0.3 primary)
| Family | Verdict | n | games | effN | Brier | LogLoss | ECE | ECE_SE | bias | reasons |
|--------|---------|---|-------|------|-------|---------|-----|--------|------|---------|
| nhl:ml_regulation | **PASS** | 650 | 650 | 650.0 | 0.2504 | 0.6944 | 0.0380 | 0.0150 | -0.018 | — |
| nhl:ml_final | **PASS** | 650 | 650 | 650.0 | 0.2478 | 0.6887 | 0.0308 | 0.0148 | -0.031 | — |

## A/B snapshot (identical holdout games)
| Family | Profile | n | ECE | Brier | LogLoss | mad½ | verdict |
|--------|---------|---|-----|-------|---------|------|---------|
| ml_regulation | v0.2 | 650 | 0.0682 | 0.2565 | 0.7088 | 0.1005 | **FAIL** |
| ml_final | v0.2 | 650 | 0.0527 | 0.2509 | 0.6956 | 0.0866 | **FAIL** |
| ml_regulation | v0.3 | 650 | 0.0380 | 0.2504 | 0.6944 | 0.0776 | **PASS** |
| ml_final | v0.3 | 650 | 0.0308 | 0.2478 | 0.6887 | 0.0482 | **PASS** |

## Reliability (v0.3 ml_regulation)
| bin | n | avgPred | avgY | gap |
|-----|---|---------|------|-----|
| 0.2-0.3 | 5 | 0.291 | 0.800 | -0.509 |
| 0.3-0.4 | 209 | 0.367 | 0.440 | -0.073 |
| 0.4-0.5 | 366 | 0.446 | 0.440 | 0.006 |
| 0.5-0.6 | 69 | 0.526 | 0.464 | 0.062 |
| 0.6-0.7 | 1 | 0.605 | 1.000 | -0.395 |

## Verdict
- ML n reached ≥500 (ml_regulation n=650, ml_final n=650).
- v0.3 ml_regulation ECE=0.0380 (prior A/B n=316 ECE≈0.033).
- v0.3 ml_final ECE=0.0308.
- Do **not** enable production NHL serve from this expand alone.
