# NCAAF TUNING round — CLOSED UNSUCCESSFUL

**Closed:** 2026-10-17 · branch `cursor/ncaaf-tuning-cache-analysis-8b51`  
**Verdict:** Drive-sim research path **does not** meet locked M3/S2 on TUNING. Incremental levers exhausted.  
**Next:** Replacement-model **proposal only** — [`ncaaf-replacement-team-strength-proposal.md`](./ncaaf-replacement-team-strength-proposal.md). **No implementation / no spend this close-out.**

## Non-negotiables (preserved)

| Item | State |
|------|--------|
| Acceptance criteria M1–M4 / S1–S4 | **Unchanged** ([`ncaaf-reserved-eval-acceptance-criteria.md`](./ncaaf-reserved-eval-acceptance-criteria.md)) |
| Model params lock | **Unchanged** (residual 14.5 · shrink 2.0 · gap scale 1.0 · blend 0.5) |
| FINAL_EVAL | **UNTOUCHED** — no fixtures |
| Closes in predictive features | **Forbidden** (eval join only) |
| `NCAAF_GAME_LINE_SIM_VALIDATED` | **false** |
| Deploy / OTA / voice | Freeze armed · voice paused · no publish |

## Why unsuccessful

Fair cohort **n=421** (identical closes for all models; closes eval-only):

| Model | ML Brier | Δ vs market | M3 | ATS Brier | S2 |
|-------|---------:|------------:|:--:|----------:|:--:|
| Locked drive (`teamMean`) | ~0.202 | ~0.052 | FAIL | ~0.294 | FAIL |
| Best opp-adj (online) | ~0.182 | ~0.032 | FAIL | ~0.311 | FAIL |

Need M3 Δ ≤ 0.02 and S2 ATS &lt; 0.25. Best ML still short; ATS **worsens** under opp-adj.

Isolated levers (prior-season→W1, remove `teamMean`, opp-adj frozen/online) all **REJECT** under slice-aware rules: aggregate ML gains (when present) regress Week-1 margin bias and/or large-favorite (14+) ATS.

Compression diagnosis: `teamMean` blend shrinks offense gaps; score-rate cap binds **0%**. Gap-scale rejected earlier (corr flat).

## Credits (single retrieval session)

| Figure | Credits |
|-------|--------:|
| Authoritative (Odds remaining Δ) | **3 560** |
| Script ledger | **3 280** |
| Cap | 4 500 (under) |

Reconciliation: [`ncaaf-tuning-closes-credit-reconciliation.md`](./ncaaf-tuning-closes-credit-reconciliation.md).  
Retrieval agent: `bc-01a1471c-a008-7787-a77d-4ba59e943645` · branch `cursor/ncaaf-tuning-closes-3645`.

## Reproducible artifact inventory (do not delete)

| Artifact | Role |
|----------|------|
| `ncaaf-tuning-2025-w1-7-games.json` | ESPN TUNING games (471) |
| `ncaaf-tuning-2025-w1-7-closing-lines.json` (+ `.csv`) | Closes archive **470/471** |
| `ncaaf-tuning-2025-w1-7-e2b-report.json` | Retrieval report |
| `ncaaf-tuning-closes-dry-run-manifest.json` | Pre-retrieval credit dry-run |
| `ncaaf-tuning-close-joined-m3s2.json` | Locked M3/S2 score |
| `ncaaf-tuning-diagnose-baselines.md` (+ `.json`) | Error slices + baselines |
| `ncaaf-tuning-expanded-cohort-research.md` (+ `.json`) | Fair n=421 + compression audit |
| `ncaaf-tuning-isolated-levers.md` (+ `.json`) | Slice-aware lever rejects |
| `ncaaf-tuning-cache-analysis-continue.md` | Time-ordered tables |
| `ncaaf-model-params-locked.md` | Pre-data param lock |
| Scripts | `ncaafPhaseE2bClosingLines.py`, `ncaafTuningCloseJoinedScore.ts`, `ncaafTuningDiagnoseAndBaselines.ts`, `ncaafTuningExpandedCohortResearch.ts`, `ncaafTuningIsolatedLevers.ts`, `run-tuning-closes.sh` |

### Minimal repro (cache-only; no Odds)

```bash
cd artifacts/api-server
NCAAF_TUNING_SIMS=1000 node --import ./test/register-hooks.mjs ./scripts/ncaafTuningIsolatedLevers.ts
NCAAF_TUNING_SIMS=1500 node --import ./test/register-hooks.mjs ./scripts/ncaafTuningExpandedCohortResearch.ts
```

Seed: `FOOTBALL_CALIBRATION_PRIMARY_SEED`. Closes join is post-sim only.

## Explicitly not done

- No FINAL_EVAL ESPN/Odds fixtures  
- No criteria relaxation  
- No gate flip / deploy / OTA / voice resume  
- No further paid Odds this close-out  
- No replacement model implementation yet — proposal only  
