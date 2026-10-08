# NHL milestone D.2 — Regulation/OT/SO + team markets (shadow)

## Settlement
| Market | Path | Notes |
|--------|------|-------|
| ML / puck line / FG total / team total | `team.nhlFinal*` | includes OT goal or SO (+1) |
| Period totals | `team.*ByPeriod.p1..p3` | regulation only |
| P1+P2+P3 | = regulation `homeFg` | conserved |
| Props | goals/ast/pts/sog (+alts), saves | saves = goalie |

## Files
- `src/models/hockey/jointHockey.ts` v0.3.0 (form shrink + lognormal shock + milder HFA)
- `src/models/hockey/markets.ts` (regulation FG vs OT/SO final settle paths)
- `src/engine/settle.ts` (nhlFinal paths)
- `eval/runNhlChronoOos.ts` + `eval/familyCalibration.ts`
- `eval/report/NHL_CHRONO_OOS.md`, `NHL_FAMILY_GATES.md`
- `MILESTONE_NHL_CALIBRATION.md`
- `test/hockeyJoint.test.ts`

## Blockers
- Family ECE may still exceed 0.04; closing lines unlicensed
- Named player OOS depends on ESPN boxscore density
- Acceptance review before allowlist — see `MILESTONE_NHL_CALIBRATION.md`
