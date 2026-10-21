# Exploratory NCAAF score backtest

This worker-only CLI does not register a Coach engine or change the NCAAF gate.
After deployment recreate the temporary export on the new Render instance:

```sh
umask 077
psql "$CFBD_HISTORY_DATABASE_URL" -v ON_ERROR_STOP=1 -At -c "SELECT payload FROM cfbd_history_archives WHERE season IN (2024,2025) ORDER BY season,week;" > /tmp/cfbd-research-2024-2025.jsonl
node dist/ncaafBacktest.mjs /tmp/cfbd-research-2024-2025.jsonl
```

The runner reads normalized JSONL snapshots without network or database calls. It sanitizes input errors and reports the input SHA-256. Identical games are deduplicated; conflicting results fail. Both seasons are required.

The isolated regulation candidate runs 10,000 seeded draws per eligible game. Reported total and margin MAE measure expected-score errors, not calibration of simulated draws. Parameters are unchanged between seasons; 2024 is development, 2025 designated holdout. This command does no tuning.

Team means use same-season known non-OT games with kickoff more than 24 hours earlier, minimum three games per team. Target OT and unknown-OT games are excluded because regulation scores are unavailable. Exclusions are counted. This creates selection bias and does not evaluate full-game markets.

The lag is a completion proxy, not verified completion or historical availability. Retrospective data may contain corrections. This is not an authenticated pregame replay. No bookmaker quote timing, prices, injuries, venue adjustment, ROI, probability calibration, market baseline or acceptance threshold is validated. Readiness remains false. Full-game engine development and validation remain outstanding.
