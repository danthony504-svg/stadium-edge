# Milestone — Football prop calibration (C.2.2, shadow)

## Scope
Historical validation + family gates for NFL/NCAAF player props. **Shadow-only.**
No `SIM_V2_SERVE`, no allowlists, no Coach / P0 / PR#649, no merge/deploy/OTA.

## Root causes (prior ECE ≈ 0.112 NFL / 0.127 NCAAF)
1. **Proxy identity mismatch** — OOS modeled synthetic `home_qb` / `home_rb` / `home_wr` while grading ESPN game leaders (not the same identity).
2. **Overconfident pass yard budgets** — `teamYardBudget` + usage produced tight pass distributions (ECE worst on `pass_yds`).

## Corrections (smallest model change)
| Lever | Change |
|-------|--------|
| Eval grounding | Named `athlete.id` + displayName + team id; side/team match; QB `confirmed_starter`, skill `active` |
| Pass mean | Pass 8.5·pts+120 → 5.8·pts+90; rush 3.2·pts+60 → 2.0·pts+40; rec 5.5·pts+80 → 3.6·pts+55 (val-fold) |
| Dispersion | Per-draw lognormal yard-budget shock σ≈0.12 on pass/rush/rec |
| Version | `FOOTBALL_PROP_MODEL_VERSION = "0.3.2"` |

## Artifacts
- `eval/familyCalibration.ts` — `FamilyVerdict`, `evaluateFamilyGate` (minOos=500, maxEce=0.04), `effectiveSampleSize`, `clusteredEceSe`, overconfidence 80/90/95%, `compareDistributions`, format helpers
- `eval/runFootballPropOos.ts` — chrono train/val/holdout; gates on holdout; val diagnostic; main vs alt; NFL vs NCAAF; dist compare; CL → INSUFFICIENT
- `eval/report/FOOTBALL_PROP_OOS.md`
- `eval/report/FOOTBALL_FAMILY_GATES.md`
- `src/models/football/playerProps.ts` (C.2.2)

## Closing lines
No licensed archive (`CLOSING_LINE_ARCHIVE.md`). OOS uses **eval-grid −110** labeled `eval-grid-not-closing-line`. Family gate `*:closing_line_benchmark` → **INSUFFICIENT_DATA**.

## Decision (post family diagnose)
**KEEP 0.3.2** — see `MILESTONE_FOOTBALL_DECISION.md`. Named-athlete identity retained.
Val-fold probes found no safe generative MODIFY (uniform TD temper blocked by opposite RB/WR gaps).

## Commands
```bash
pnpm test
pnpm eval:prop-oos
pnpm eval:prop-family
```

## Non-goals
Serve flags, family allowlists, Coach wiring, production OTA.

## Holdout results (prop model 0.3.2)
| Sport | Family | n | ECE | Verdict |
|-------|--------|---|-----|---------|
| NFL | player_prop | 6833 | 0.0375 | FAIL (p95 overconf band; ECE≤0.04) |
| NFL | pass_yds | 2280 | 0.0252 | PASS |
| NCAAF | player_prop | 9688 | 0.0742 | FAIL |
| both | closing_line_* | 0 | — | INSUFFICIENT_DATA |

Prior proxy-identity ECE was ~0.112 / 0.127 on n≪500. Named-player + val mean scales cleared NFL pass_yds and brought NFL overall ECE under 0.04; family still gated by extreme-alt p95 hit rate and NCAAF residual bias.

