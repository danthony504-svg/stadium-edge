# Game Simulator research review

The Simulator tab can opt into an isolated backend's event-level research models. Other callers keep the existing models. The backend selects an exact sport, event, home participant, and away participant. It uses the latest trusted pregame snapshot available before the event. Missing snapshots fall back to existing estimates, with genuine event replays available only when the response supplies them.

Configure `SPORT_EVENT_REVIEW_SNAPSHOTS` with the path of a trusted JSON array of records matching `EventSnapshot` in [eventKernels.ts](eventKernels.ts). For NBA and WNBA use [the basketball snapshot configuration](nbaPossessionReview.md). For tennis, use the participant names as the roster IDs if the game picker lacks ESPN IDs. Game-time and receipt timestamps use epoch milliseconds. Publish lineup and availability corrections as new snapshots. Keep the model's no-vig anchor frozen within each revision. A new requested line re-scores the stored draws. It does not change the model's market anchor or trigger a new random draw.

The fixtures exercise these review models.

- NFL uses an offense state with clock, down, distance, field position and score. The overtime clock is a simplified approximation. Detailed NFL overtime possession and special-teams rules still need a separate validation pass.
- NBA and WNBA share the possession engine. WNBA uses 200 team minutes in regulation, stronger prior shrinkage, and a larger rest penalty for short turnarounds.
- MLB uses a supplied batting order, discrete plate appearances, base state, starter workload, bullpen role, park and wind. Set `automaticRunner` for the competition's extra-inning rules.
- NHL uses different shot quality for power plays, state-dependent shot volume, goalie shrinkage and an extra-attacker approximation. The shootout winner gets the settlement adjustment for full-game lines. It does not credit a player goal. Shootout attempts are not modeled.
- Soccer uses timed shots and finishing, a low-score adjustment, red-card state and changed roles late in the match. Standard lines settle over the recorded 90-minute score. Knockout extra time and penalty deciders are shown in the replay.
- Tennis uses supplied surface-specific serve priors, point scoring, regular and deciding-set tiebreak options, and best-of-three or best-of-five. Total games and set scores use completed draws. The review displays retirement rates separately and has no book-specific retirement rules.

The kernels use supplied pregame lineup and role data. They do not fit rating inputs or connect directly to lineup, injury, weather, or closing-line feeds. The uncertainty ranges are exploratory. Fit, verify and validate each sport with chronological independent holdouts before routing live picks or recommendations to these models.

Run the backtest by supplying one captured event and independently settled result per JSONL row.

```sh
node --import ./artifacts/api-server/test/register-hooks.mjs artifacts/api-server/scripts/eventSimBacktest.ts captures.jsonl
```

Soccer finals must be marked `regulation`, tennis `completed_match` with an explicit winner, and other non-basketball results `full_game`. For basketball use the field conventions in `nbaPossessionBacktest.ts`. The harness reports per-sport win and cover calibration, paired no-vig closing comparisons, spread movement, and 80% predictive margin and total coverage. A closing probability for cover comparisons must refer to the original posted threshold.
