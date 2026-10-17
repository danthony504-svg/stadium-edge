# FINAL_EVAL ML archive retrieval — complete (unscored)

**ODDS_API_KEY:** PRESENT (not printed)  
**Split:** FINAL_EVAL only · TUNING skipped · scored: **false** · deploy/OTA/unlock: **false**

## Caps / spend
| Pull | Cap | Spent | Cap stop |
|------|----:|------:|:--------:|
| Close h2h | 2100 | 1680 | False |
| Early T−24h h2h | 2100 | 1670 | False |
| **Combined** | **4200** | **3350** | None |

Remaining after pull: **3,773,062** (Δ **3,350** vs pre-pull probe 3,776,412).

## Coverage (membership n=408)
| Archive | Matched two-sided | Missing | Reasons |
|---------|------------------:|--------:|---------|
| Close h2h | 364 | 44 | 39 no_odds_match · 5 missing_two_sided_ml |
| Early T−24h h2h | 364 | 44 | 39 no_odds_match · 5 missing_two_sided_ml |

Coverage flag: **INCOMPLETE** (missing games, not credit cap).

## Outputs
- `test/fixtures/ncaaf-final-eval-close-h2h-archive.json`
- `test/fixtures/ncaaf-final-eval-early-t24h-h2h-archive.json`
- `test/fixtures/ncaaf-final-eval-ml-archive-retrieval-report.json`

## Non-actions
No FINAL_EVAL scoring · no TUNING pull · no deploy/OTA · no NCAAF unlock · spreads blocked

