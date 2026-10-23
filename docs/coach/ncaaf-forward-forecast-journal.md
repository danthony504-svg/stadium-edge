# Forward NCAAF forecast journal

This research-only command freezes the current full-game candidate's probabilities before kickoff. It does not enable NCAAF in Coach, alter any quality floor, or certify the candidate.

## Input and execution

Build the API, then run from `artifacts/api-server`:

```sh
node dist/ncaafForecastJournal.mjs /private/path/forecast-input.json
node dist/ncaafForecastJournal.mjs /private/path/forecast-input.json --execute
```

The first command validates and reports a plan without connecting to the database. Execution uses the existing `DATABASE_URL`, checks the production database name, and resolves pg through the repository's `lib/db/package.json`. `NCAAF_REPO_ROOT` can override the default Render checkout root.

The version-1 JSON input has:

- `target`: season, numeric event/home/away IDs, kickoff ISO timestamp, and ruleset.
- `games`: settled `TimedGame` rows as defined in `ncaafFullGameBacktest.ts`, including authentic completion/observation timestamps and regulation scores for overtime rows. At least three eligible same-season games per team and thirty distinct compatible overtime observations are required.
- `quotes`: exact two-sided `ReplayQuote` rows for the target, including bookmaker, market, line, both prices, observation timestamp and full-game settlement.
- `injuryEvidence`: key, observedAt, sha256, rawResponse and absentTeamStatus (`unknown`) copied from the existing database archive. Execution verifies these against the database; absent teams are never treated as healthy.

The journal stores complete inputs, their SHA-256, model version, 10,000-draw probabilities, and database-generated `recordedAt`. The DB clock guards insertion before kickoff; another check before commit rolls back a crossed deadline. A unique model/season/event key preserves the first forecast; conflicts never overwrite it. Credentials are not logged. Outcomes are scored separately using `scoreRecordedForecast`; it uses saved probabilities and excludes actual pushes from Brier scores.

## Remaining blockers

This is a recorder, not an automated data adapter or scheduler. Do not supply invented timestamps or synthetic fixtures as real evidence. Current historical odds archives alone do not contain all required inputs. Quote and settled-history source assertions still require independent verification; the journal deliberately marks source provenance unverified and validation readiness false.

The candidate still needs injury/opponent/venue validation and an independent holdout. The existing historical acceptance gate requires at least 500 settled games spanning two seasons, exact line binding, injury conservatism, market comparison and human signoff. Forecast journaling today cannot create historical pregame forecasts. No unlock date is implied by this change. No new cron, production migration, Coach request path, OTA or release gate is changed.
