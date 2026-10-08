# Basketball milestone E.2 — Full team markets + combos (shadow)

## Coverage
- ML, spread, totals, team totals (FG + period where league allows)
- Props: points/reb/ast/threes (+alts), PRA/PR/PA/RA, points_q1 (NBA/WNBA only)
- NCAAB: halves only — quarter markets throw

## Validation
- Unit: `test/basketballJoint.test.ts`
- Chrono OOS: `npm run eval:basketball-oos` → `eval/report/BASKETBALL_CHRONO_OOS.md`
  - **Defect fixed:** NBA/WNBA week ESPN API returns 0 → date-sample harness
  - NBA: train 439 / hold 482 / obs 291 / ECE 0.065 / mean 4.9 ms
  - WNBA: train 89 / hold 97 / obs 162 / ECE 0.035 / mean 3.9 ms
  - NCAAB: train 3597 / hold 3796 / obs 297 / ECE 0.089 / mean 4.9 ms
  - Gate n≥500: **NOT MET** per league (holdout capped)

## Gates
NBA / WNBA / NCAAB keep separate `sport:family` keys and OOS sections.
`SIM_V2_SERVE=off`; production allowlists empty.

## Blockers
- n≥500 per league not met at current holdout cap
- Closing-line archive; named player prop OOS
- Spread ECE elevated vs ML/totals on all three leagues
