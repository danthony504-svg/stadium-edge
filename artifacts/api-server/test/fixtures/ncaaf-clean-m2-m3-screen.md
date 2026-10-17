# Clean engine M2 rerun + M3 TUNING screen

**Stamp:** `ncaaf-score-margin-v1-research`  
**Generated:** 2026-10-17T11:45:20.717Z  
**FINAL_EVAL:** UNTOUCHED · closes eval-only · injury unavailable (E4 open) · no spend/deploy/OTA/unlock

## Venue sidecar (M2 rerun)

| Kind | n |
|------|--:|
| Home stadium | 465 |
| Neutral | 6 |
| Unknown | 0 |
| ok predictions | 350 |
| evaluableSupported | 350 |

Withholds: `{"fbs_fcs_unsupported_scope":119,"unrated_fbs_side":2}`

## FBS–FCS 119 vs 85

**Cohort difference, not classification error** — see `ncaaf-clean-fbs-fcs-cohort-reconcile.md`.
Full ESPN TUNING FBS–FCS=119; fair close-joined FBS–FCS=85 (421 − 334 − 2 unrated).

## Residual sign

`residual = (homeScore − awayScore) − marginMean`

- **Positive** → actual home margin larger than predicted (model understated home edge)
- **Negative** → actual home margin smaller than predicted
- Prior M2 (all venues unknown, HFA withheld): mean residual **+6.11**

## M3 TUNING screen (supported + verified venue + closes)

| Slice | n ML | ML Brier | Mkt Brier | Δ vs mkt | M3 | ATS n | ATS Brier | S2 | mean residual |
|-------|-----:|---------:|----------:|---------:|:--:|------:|----------:|:--:|--------------:|
| Overall | 334 | 0.1976 | 0.1767 | 0.0210 | false | 326 | 0.2604 | false | 2.935 |
| Week 1 | 47 | 0.2093 | 0.1371 | 0.0723 | false | 47 | 0.2432 | true | 3.988 |
| 14+ fav (abs>14 canonical) | 94 | 0.1225 | 0.0741 | 0.0484 | false | 94 | 0.2672 | false | 7.077 |
| 14+ fav (abs≥14 sensitivity) | 107 | 0.1389 | 0.0986 | 0.0403 | false | 107 | 0.2674 | false | 6.695 |

Baselines: coin ML Brier overall 0.2500; coin ATS 0.2500.

**Naming:** `evaluableSupported` = research inputs complete enough to score (retired name: `releaseEligible`). `productionReleaseApproved=false` always on this stamp — the 350 preds are **evaluable, not production-approved**.

**14+ reconcile:** spread=`closeSpreadHome`; favorite=`abs(closeSpreadHome)`; ATS pushes excluded. First screen used abs≥14 (n=107); identical-334 canonical is abs>14 (n=94; 13 at exactly 14).

**Screening only — not a restore / FINAL_EVAL pass.**
