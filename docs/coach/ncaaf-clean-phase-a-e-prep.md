# Phases A–E prep — clean E1 ML-only (no paid retrieval)

**Generated with execution of A + prep of B/C/D/E**  
**Candidate:** frozen E1 α=1.15  
**FINAL_EVAL scored:** false · **Paid retrieval:** false · Spreads blocked · voice paused · gate false

| Phase | Status | Artifact |
|-------|--------|----------|
| **A** ML-only harness | **Executed** (TUNING screen + unit tests) | `ncaaf-clean-ml-only-harness-tuning.md` · `src/lib/sportSim/ncaafClean/mlOnlyHarness.ts` |
| **B** FINAL_EVAL membership | **Prepared** via free ESPN | `ncaaf-final-eval-membership.md` |
| **C** Close-only h2h manifest | **Prepared** dry-run · hard cap **2000** | `ncaaf-final-eval-odds-request-manifests.md` |
| **D** Early T−24h CLV manifest | **Prepared** dry-run · hard cap **2200** (separate) | same |
| **E** Forward injury collector | **Prepared inactive** (`NCAAF_INJURY_COLLECTOR_ACTIVE` unset) | `ncaaf-forward-injury-collector-prep.json` |

## Harness guarantees

- Locked M1–M4 + C1–C6 thresholds unchanged  
- TUNING never yields `finalPass=true`  
- FINAL_EVAL scoring requires `allowFinalEvalScoring=true` (default off)  
- S2/spreads = `BLOCKED_SEPARATE_GATE`  
- Closes eval-only  

## Non-actions honored

No Odds HTTP · no FINAL_EVAL M1–M4 score · no deploy/OTA/unlock · no injury activation · no plan changes
