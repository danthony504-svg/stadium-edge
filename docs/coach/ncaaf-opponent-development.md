# Opponent-strength development experiment

Worker CLI only. No production engine registration, Coach calls, gates, migrations or provider requests.

After deployment, recreate the research export on the new instance, then run:

```sh
umask 077
psql "$CFBD_HISTORY_DATABASE_URL" -v ON_ERROR_STOP=1 -At -c "SELECT payload FROM cfbd_history_archives WHERE season IN (2024,2025) ORDER BY season,week;" > /tmp/cfbd-research-2024-2025.jsonl
node dist/ncaafOpponentDevelopment.mjs /tmp/cfbd-research-2024-2025.jsonl
```

Only 2024 snapshots are consumed for fitting, evaluation and the development-input hash. There is no 2025 evaluation option. Previous v1 2025 results have already been inspected; any later evaluation must disclose that and avoid repeated adaptive selection on that season. New future shadow data is still required for independent confirmation.

For each eligible target, fit expected score = earlier same-season league mean + team offense + opposing defense using ridge regression. The intercept is fixed at the earlier league mean. Team effects shrink toward zero with fixed experimental ridge penalty 4; deterministic coordinate descent runs 100 sweeps. These choices are not tuned or validated. At least three earlier known non-OT games per target team are required; the same 24h kickoff lag applies as the original runner. Predictions outside 0..84 are excluded, not clipped. The original arithmetic model and new model are evaluated on the exact same valid cohort, with all exclusions reported. Identical/conflicting snapshot handling follows the existing parser.

Output: expected total/margin MAE for each model and paired retrospective bookmaker comparisons. This experiment has no stochastic scoring distribution: it does not run Monte Carlo simulations or measure probabilities, ROI or bet wins. A lower MAE would only be development evidence. Higher errors mean reject/rework the candidate, not lower the acceptance bar.

Neutral-site metadata was not retained by the importer. No home/away advantage is inferred from home/away IDs; venue adjustment is deferred. Injuries, completion timestamps, historical revision availability, verified pregame/closing quotes, full-game overtime settlement and probability calibration remain missing. Known non-OT filtering introduces selection bias. Production and validation readiness always remain false.
