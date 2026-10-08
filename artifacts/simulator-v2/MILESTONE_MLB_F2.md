# MLB milestone F.2 — Full team markets + starters (shadow)

## Coverage
- FG + F5: ML, run line, totals, team totals (provider keys preserved)
- Props: hits / total bases / HR / K (+alts where keyed), RBIs, stolen bases
- Starter / batting-order participation fail-closed (non-starter pitcher, no-order batter → `missing_data`)
- Opp pitcher K/9 matchup scalar on batter rates when provided
- F5 ⊆ FG conserved on every draw; 10k-draw settlement tests

## Validation
- Unit: `test/baseballJoint.test.ts` (F.2) — pass
- Chrono OOS: `npm run eval:mlb-oos` → `eval/report/MLB_CHRONO_OOS.md`
  - obs=720 (n≥500 **met**), games_clustered=120
  - overall Brier 0.2599 / LogLoss 0.7178 / ECE 0.0896
  - Mean runtime/game 1.8 ms (p95 proxy 2.7 ms)
- ESPN date-sampled scoreboard (week API returns empty for MLB — harness defect fixed)

## Gates / isolation
- `SIM_V2_SERVE=off`; production allowlists empty
- No Coach / P0 / qualification / correlation production rule changes

## Blockers
- Named player-prop chronological OOS (boxscore leaders) not yet wired
- Closing-line sportsbook baseline not in harness (grid −110 only)
- ECE still above typical 0.04 acceptance threshold (esp. ML ECE 0.2289)
