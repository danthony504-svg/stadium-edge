# NCAAB research validation pipeline

Separate from NCAAF. Captures prospective NCAAB live inputs and settles saved research forecasts against authenticated ESPN finals. **Does not unlock Coach.**

## Principles

- Keys live under `research:ncaab:*` only — never read or rewrite `research:ncaaf:*`.
- `coachEnabled` / `releaseEligible` remain false until an independent multi-season holdout and human signoff exist.
- `ncaab-score-v2` is product-sim infrastructure, not a release-approved model.
- Development examples and independent holdouts must stay distinct; old predictions are never relabelled.

## Activation

Set `NCAAB_RESEARCH_PIPELINE_ENABLED=true` on the API service (default off). Uses existing `DATABASE_URL` and `ODDS_API_KEY`. API boot and the notification cron enqueue `ncaabResearchWorker` as a separate process.

## Stages (v1)

1. Settlement check — lists unsettled `research:ncaab:forecast:*` rows whose kickoff is at least four hours earlier. ESPN `mens-college-basketball` summary binding (`scripts/ncaab-bind-final-summary.mjs`) authenticates the final; `scoreNcaabRecordedForecast` scores saved ml/spread/total probabilities without re-simulating. First write wins (`ON CONFLICT DO NOTHING`). Missing finals stay unsettled for a later slot. Cadence is at most once per 30 minutes, batch ≤64, no paid odds.
2. Live-input capture (`scripts/ncaab-capture-live-inputs.mjs`) — The Odds API `basketball_ncaab` h2h/spreads/totals with exact `sourceUpdatedAt`, matched to ESPN mens-college-basketball scoreboard by team aliases + kickoff.
3. Journal — waits for a frozen NCAAB candidate (`research:ncaab:adjusted-model:latest`); does not invent forecasts.

Release requirements mirror the research bar: **500** independent games across **≥2** seasons, calibration review, human approval.

## Status

- Public inventory: `GET /api/research/ncaab/status`
- Internal: `GET /api/notifications/ncaab-research/status` (cron key)

Settlement status includes `settlementsRecorded`, `unsettledInBatch`, and allowlisted blockers. A processed settlement check with zero forecasts is healthy plumbing, not validation evidence.

## Verification

1. Deploy a commit that includes this scaffold.
2. Confirm `/api/healthz` SHA.
3. With the env flag off, status still returns `coachEnabled:false` and `decision:BLOCKED`.
4. With the flag on and odds credentials present, a slot should write `research:ncaab:live-inputs:*` and leave forecast counts at 0 until a frozen candidate exists.
5. After a saved research forecast exists and ESPN posts a final, settlement should write `research:ncaab:settlement:*` with `releaseEligible:false`.

## Out of scope for v1

- Adjusted-model trainer / freeze
- Forecast journal wiring (still blocked on a frozen candidate)
- Coach mobile unlock / OTA
- Reusing NCAAF conference or availability collectors
- Importing NCAAF journal/scorer modules (frozen football implementation surface)
