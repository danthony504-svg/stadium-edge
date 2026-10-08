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
| nhl:ml_regulation | **FAIL** | 650 | 650 | 650.0 | 0.2510 | 0.6958 | 0.0439 | 0.0152 | -0.018 | ece_0.0439_gt_0.04 |
| nhl:ml_final | **PASS** | 650 | 650 | 650.0 | 0.2478 | 0.6888 | 0.0313 | 0.0141 | -0.031 | — |

## A/B snapshot (identical holdout games)
| Family | Profile | n | ECE | Brier | LogLoss | mad½ | verdict |
|--------|---------|---|-----|-------|---------|------|---------|
| ml_regulation | v0.2 | 650 | 0.0682 | 0.2565 | 0.7088 | 0.1005 | **FAIL** |
| ml_final | v0.2 | 650 | 0.0527 | 0.2509 | 0.6956 | 0.0866 | **FAIL** |
| ml_regulation | v0.3 | 650 | 0.0439 | 0.2510 | 0.6958 | 0.0802 | **FAIL** |
| ml_final | v0.3 | 650 | 0.0313 | 0.2478 | 0.6888 | 0.0523 | **PASS** |

## Reliability (v0.3 ml_regulation)
| bin | n | avgPred | avgY | gap |
|-----|---|---------|------|-----|
| 0.2-0.3 | 9 | 0.284 | 0.778 | -0.494 |
| 0.3-0.4 | 215 | 0.364 | 0.437 | -0.073 |
| 0.4-0.5 | 337 | 0.446 | 0.439 | 0.006 |
| 0.5-0.6 | 87 | 0.528 | 0.460 | 0.068 |
| 0.6-0.7 | 2 | 0.609 | 0.500 | 0.109 |

## Verdict
- ML n reached ≥500 (ml_regulation n=650, ml_final n=650) — prior INSUFFICIENT (n=316) **resolved for sample size**.
- v0.3 ml_regulation ECE=0.0439 → **FAIL** (prior thin-n ECE≈0.033 did not hold).
- v0.3 ml_final ECE=0.0313 → **PASS** (only KEEP candidate).
- Do **not** enable production NHL serve from this expand alone.

## Notes
- Week API `dates={season}` returns the prior NHL campaign; combined with Oct–Jun date sampling this densifies the chrono pool (same protocol as prior A/B, denser stride). Deduped by `eventId`.
- Decision board: `MILESTONE_NHL_DECISION.md`.
