# NCAAF restoration attempt — CLOSED (identical-334 scorecard)

**Closed:** 2026-10-17 · branch `cursor/ncaaf-tuning-cache-analysis-8b51`  
**Verdict:** Supported FBS–FBS team-strength research **does not** meet locked M3/S2. Restoration attempt **closed**.  
**Final scorecard:** [`ncaaf-tuning-identical-334-finish.md`](./ncaaf-tuning-identical-334-finish.md)  
**Next (proposal only):** [`ncaaf-team-strength-next-inputs-proposal.md`](./ncaaf-team-strength-next-inputs-proposal.md) — **no implementation / no spend this close-out.**  
**Clean engine (design):** [`ncaaf-clean-engine-design.md`](./ncaaf-clean-engine-design.md) — stop extending drive/v0; architecture + milestones for review before any new scoring code.

## Non-negotiables (preserved)

| Item | State |
|------|--------|
| Acceptance criteria M1–M4 / S1–S4 | **Unchanged** |
| Model params lock (drive residual/shrink) | **Unchanged** |
| FINAL_EVAL | **UNTOUCHED** — no fixtures |
| Closes in predictive features | **Forbidden** (eval join only) |
| `NCAAF_GAME_LINE_SIM_VALIDATED` | **false** |
| Deploy / OTA / voice | Freeze armed · voice paused · no publish |
| Production OTA | `.ota-production-freeze` intact |

## What this attempt preserved (keep)

| Artifact / behavior | Path / note |
|---------------------|-------------|
| Verified season-specific FBS/FCS IDs | `artifacts/api-server/test/fixtures/ncaaf-subdivision-espn-ids.json` |
| Subdivision classifier + transitions | `ncaafSubdivision.ts` |
| Chronological FBS–FBS-only rating rebuild | `ncaafTeamStrength.ts` (no invented default-24 μ) |
| Explicit unsupported / unrated → Coach withhold | `ncaafTeamStrengthSupport.ts` |
| Retag sidecars (original games unchanged) | `*.subdivision-tags.json` |
| Regressions | `test/ncaafSubdivision.test.ts`, `test/ncaafTeamStrength*.test.ts` |
| Repro scripts | `ncaafRetagSubdivision.ts`, `ncaafTuningSubdivisionFixCompare.ts` |
| Pipeline audit | [`ncaaf-tuning-pipeline-audit.md`](./ncaaf-tuning-pipeline-audit.md) |

**FBS–FCS remains an unsupported scope** (withhold) — never a validation pass/fail.

## Final scorecard (identical n=334)

Same event IDs for every model (verified team-strength rated predictions only).

| Model | ML Brier | Δ vs mkt | M3 | ATS Brier | S2 | bias |
|-------|---------:|---------:|:--:|----------:|:--:|-----:|
| `locked_drive_teamMean` | 0.2267 | 0.0500 | FAIL | 0.2734 | FAIL | +0.9 |
| `ts_full_before_legacyHeuristic` | 0.1955 | 0.0189 | true* | 0.2549 | FAIL | −2.6 |
| `ts_full_after_verifiedIds` | 0.2002 | 0.0235 | FAIL | 0.2571 | FAIL | −2.5 |

\*Legacy M3-true is **polluted classification** — **not** acceptance.

| Slice of identical 334 | n | ts_after ML Δ | ts_after ATS | Notes |
|------------------------|--:|--------------:|-------------:|-------|
| Week 1 | 47 | 0.0718 | 0.2412 (S2 true on thin slice) | Not overall ready |
| 14+ favorites | 94 | 0.0581 | 0.2636 | Bias −6.6 |

### Exclusions from fair 421 → 334

| Reason | n | Coach |
|--------|--:|-------|
| `fbs_fcs_unsupported_scope` | 85 | withhold |
| `unrated_fbs_side` | 2 | withhold (Missouri State / Delaware first FBS games) |

## Readiness at close

| Scope | ML | ATS |
|-------|----|-----|
| Supported FBS–FBS (identical 334) | **not ready** | **not ready** |
| Unsupported FBS–FCS | withhold only | withhold only |

## Out of scope this close-out

- No new model, no parameter retune, no paid Odds  
- No FINAL_EVAL build or peek  
- No NCAAF unlock, deploy, OTA, or voice resume  

## Product focus after close

Return to **verifying and releasing already-tested Coach fixes for supported sports** on separate branches/PRs (NCAAF P0 stays armed / gate false). This restoration thread does not block those fixes.

## Repro (frozen artifacts)

```bash
cd artifacts/api-server
node --import ./test/register-hooks.mjs --test test/ncaafSubdivision.test.ts test/ncaafTeamStrength.test.ts test/ncaafTeamStrengthSupport.test.ts
NCAAF_TUNING_SIMS=1000 NCAAF_TEAM_STRENGTH_RESEARCH=1 node --import ./test/register-hooks.mjs ./scripts/ncaafTuningSubdivisionFixCompare.ts
```
