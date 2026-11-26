# NBA and WNBA possession simulator review

The NBA Simulator tab can request the research engine through the existing game-outcome endpoint. Configure an isolated review server with `NBA_POSSESSION_REVIEW_SNAPSHOTS` pointing to a trusted JSON array of `NbaPregame` records. Match the event ID from the Simulator game picker and both ESPN team IDs. Set `sport` to `wnba` for WNBA snapshots. Records include confirmed lineups, timestamps, rotation and role data, team ratings, pace, rest, shot/turnover/rebound/free-throw rates, and an optional no-vig market anchor. Minutes start from a 240-minute NBA or 200-minute WNBA rotation and explicit injury transfers move those minutes to the listed replacement players. The engine applies minutes caps and uses the supplied lineup ordering when starting each team.

Existing clients and Coach do not opt in. Without an eligible snapshot, the API keeps the existing score-model response. The NBA research UI uses the engine’s sampled quarter and overtime scores, shows the matching box score, and limits its market display to research probabilities and push rates. It does not feed new recommendations into the app.

The server holds up to four matchup draw sets. It reuses the same typed arrays when a client changes the line and regenerates when the supplied model snapshot changes. Publish a new snapshot when verified availability or lineups change. Use the market anchor embedded in the snapshot for the model and the posted line on the request for scoring. The live quote threshold does not seed or rerun the model.

Run a holdout with one pregame snapshot and one independently settled final per JSONL row. The optional `open` and `close` fields identify timestamped lines for calibration and closing-line comparison.

```sh
node --import ./artifacts/api-server/test/register-hooks.mjs artifacts/api-server/scripts/nbaPossessionBacktest.ts captures.jsonl
node --import ./artifacts/api-server/test/register-hooks.mjs --test artifacts/api-server/test/nbaPossessionV3.test.ts
```

The report measures win and cover Brier score and log loss, calibration buckets, spread movement, and 80% predictive margin and total coverage. The 80% hit-chance ranges are approximate rating-uncertainty ranges, adjusted for Monte Carlo sampling within each block. They require independent calibration. Automated ingestion, independent NBA backtesting, and device verification are required before release.
