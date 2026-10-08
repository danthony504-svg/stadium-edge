# Football milestone C.2 — Prop settlement + chrono OOS (shadow)

## Coverage
| Provider key family | Settle stat | Alt | Notes |
|---------------------|-------------|-----|-------|
| pass yds/attempts/completions/tds | pass_* | yds/att/comp/tds | shared team pass budget |
| rush yds/attempts/tds | rush_* | yds/att | allocated from team rush |
| reception yds/receptions/tds | rec_* | yds/rec | allocated from team rec |
| anytime TD | any_td | — | yes/no |
| kicking_points / tackles / solo / def INT | DST/K | — | NFL provider DST batch only |
| pass/rush/rec yds Q1/H1 + pass_tds_q1 | *_q1/_h1 | — | joint with period points |

## Files
- `src/models/football/playerProps.ts` (C.2)
- `src/models/football/markets.ts` (provider map + reject missing alts)
- `src/engine/settle.ts` (OUT / no-participation → missing_data)
- `eval/runFootballPropOos.ts`
- `test/footballPlayerProps.test.ts`

## Validation
- Unit: 10k draws, correlation, OUT reject, QH/DST settle
- Chrono: `pnpm eval:prop-oos` → `eval/report/FOOTBALL_PROP_OOS.md`

## Blockers
- Leader proxy ≠ named book player identity
- Closing-line archive missing
- n≥500 gate may not clear on first OOS pass
- Coach path still V1-only by flags
