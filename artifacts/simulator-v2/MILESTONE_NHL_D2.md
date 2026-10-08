# NHL milestone D.2 — Regulation/OT/SO + team markets (shadow)

## Settlement
| Market | Path | Notes |
|--------|------|-------|
| ML / puck line / FG total / team total | `team.nhlFinal*` | includes OT goal or SO (+1) |
| Period totals | `team.*ByPeriod.p1..p3` | regulation only |
| P1+P2+P3 | = regulation `homeFg` | conserved |
| Props | goals/ast/pts/sog (+alts), saves | saves = goalie |

## Files
- `src/models/hockey/jointHockey.ts` v0.2.0
- `src/models/hockey/markets.ts`
- `src/engine/settle.ts` (nhlFinal paths)
- `eval/runNhlChronoOos.ts`
- `test/hockeyJoint.test.ts`

## Blockers
- Chrono n may be <500; ESPN week fetch incomplete
- Named player OOS / closing lines
- Acceptance review before allowlist
