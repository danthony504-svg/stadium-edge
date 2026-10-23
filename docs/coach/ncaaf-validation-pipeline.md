# NCAAF research validation pipeline

The pipeline automates research capture, immutable pregame forecasts, and scoring of saved probabilities. It does not unlock Coach or certify model quality.

## Activation and execution

Set `NCAAF_RESEARCH_PIPELINE_ENABLED=true` on the API service and deploy the current source. Existing `DATABASE_URL` and `ODDS_API_KEY` stay on that service; do not copy credentials to another job. API startup and the existing authenticated notification cron enqueue a separate Node process. No collection or simulation runs inside a Coach request. The notification job retains its existing behavior.

The database clock assigns each run to the latest UTC slot at 02:00, 14:00, 18:00, or 22:00. Completed slots are skipped. A database advisory lock prevents overlap across API instances. A charged current-odds attempt is persisted before the request, so a crashed run cannot repeat that attempt within its slot. Failed slots have a five-minute backoff and at most three attempts. A slot whose request failed may therefore withhold forecasts until a later slot rather than spend another request automatically.

Collectors have an eight-minute deadline; the worker has a twelve-minute deadline and bounded Node heaps. Matched targets are limited to 128 and two seasons; settlement batches are limited to 64. Existing capture scripts retain their own provider and cache limits. History summaries refresh matched-team schedules per slot and reuse durable game summaries.

## Evidence and status

All research records use `research:ncaaf:*` keys in `app_kv`. `research:ncaaf:pipeline:latest` reports the current phase, completion or failure, forecast counts, history counts, and explicit blockers. Slot records retain request-attempt state. The authenticated `GET /api/notifications/ncaaf-research/status` endpoint returns this report using the existing cron key. Unauthenticated callers receive 403; no secrets or raw archives are returned.

Forecast writes require a database clock before kickoff and preserve the first model/event record. Inputs retain raw source hashes and durable references. Absent injury teams remain unknown. Outcomes must exactly match a saved forecast; pushes are excluded from Brier averages. Reports separate model, season, bookmaker, and market, and count distinct events rather than treating each book quote as another game.

The candidate still requires its existing minimum overtime sample. Historical finals collected today cannot establish historical pregame information availability. Every pipeline report has `releaseEligible:false`; source/ruleset review, injury/opponent/venue calibration, an independently verified multi-season holdout, and human signoff remain separate release requirements. No confidence or grade floor changes are made.

## Verification and rollback

Verify the deployed commit, API health, protected endpoint authentication, and the durable latest/slot reports. A processed slot with explicit withheld forecasts proves the pipeline ran; it does not prove the model passed. A later cron invocation should skip the same completed slot without another charged odds attempt.

To disable collection, set `NCAAF_RESEARCH_PIPELINE_ENABLED=false` and redeploy. Existing research data remains intact and the production NCAAF release gate stays unchanged.
