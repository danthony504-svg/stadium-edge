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

## Current quote and identity collector

`node scripts/ncaaf-capture-live-inputs.mjs` prints a plan with no network or database activity. Add `--execute` in the existing Render service shell to capture current full-game quotes and ESPN identities using existing `ODDS_API_KEY` and `DATABASE_URL` values. One execution makes at most one paid Odds API request and eight ESPN date requests, without retries; a minute cache and advisory lock prevent overlapping duplicate captures. It writes only `research:ncaaf:live-inputs:<UTC-minute>` keys. Original responses, receipt times and SHA-256 hashes are retained. Errors print no credentials or provider response bodies.

Matching requires normalized full names, home/away sides and the exact kickoff instant. Aliases, different kickoff times and ambiguous identities are excluded. Both prices must come from one bookmaker/market with opposite spread points or equal total points. Markets older than fifteen minutes, unpaired outcomes and early-period markets are excluded. The collector reports exclusions; it never substitutes a price or invents a line. Empty boards can be archived without manufacturing candidates.

The journal can load a capture directly from the database:

```sh
node dist/ncaafForecastJournal.mjs /private/path/history.json \
  --live-input-key research:ncaaf:live-inputs:YYYY-MM-DDTHH:mm \
  --event-id VERIFIED_ESPN_ID --ruleset VERIFIED_RULESET_TAG
```

Here `history.json` contains `{ "games": [...] }` with authentic timed `TimedGame` rows, not invented timestamps. Without `--execute` this performs database reads and a plan only. Add `--execute` only after the plan passes to write the forecast. The adapter verifies raw response hashes, exact quote prices/lines, source freshness and ESPN identities, attaches original live responses, and reads the durable injury archive. It does not fetch, infer or backfill missing historical inputs. A ruleset label still needs external verification; a supplied label does not certify compatibility.

This connects captured current quotes to the recorder. Verified historical game availability, regulation/OT evidence, model calibration, automated forecast scheduling and the multi-season acceptance test remain separate requirements. Do not deploy a forecast cron that repeatedly fails for missing history.

### ESPN day-boundary correction

Current-quote collection now selects ESPN board dates in `America/New_York`, including DST, rather than using UTC kickoff dates. This prevents evening games after UTC midnight from requesting the next local board. Repeated identical identities across board responses preserve the earliest actual receipt; conflicting identities still reject. Old raw archives remain unchanged; a new current capture is needed to benefit from this correction.
