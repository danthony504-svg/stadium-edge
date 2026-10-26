# NCAAB research validation pipeline

Separate from NCAAF. Captures prospective NCAAB live inputs and maintains research status. **Does not unlock Coach.**

## Principles

- Keys live under `research:ncaab:*` only — never read or rewrite `research:ncaaf:*`.
- `coachEnabled` / `releaseEligible` remain false until an independent multi-season holdout and human signoff exist.
- `ncaab-score-v2` is product-sim infrastructure, not a release-approved model.
- Development examples and independent holdouts must stay distinct; old predictions are never relabelled.

## Activation

Set `NCAAB_RESEARCH_PIPELINE_ENABLED=true` on the API service (default off). Uses existing `DATABASE_URL` and `ODDS_API_KEY`. API boot and the notification cron enqueue `ncaabResearchWorker` as a separate process.

## Stages (v1)

1. Settlement check — lists unsettled research forecasts; outcome binding lands in a later PR.
2. Live-input capture (`scripts/ncaab-capture-live-inputs.mjs`) — The Odds API `basketball_ncaab` h2h/spreads/totals with exact `sourceUpdatedAt`, matched to ESPN mens-college-basketball scoreboard by team aliases + kickoff.
3. Journal — waits for a frozen NCAAB candidate (`research:ncaab:adjusted-model:latest`); does not invent forecasts.

Release requirements mirror the research bar: **500** independent games across **≥2** seasons, calibration review, human approval.

## Status

- Public inventory: `GET /api/research/ncaab/status`
- Internal: `GET /api/notifications/ncaab-research/status` (cron key)

## Verification

1. Deploy a commit that includes this scaffold.
2. Confirm `/api/healthz` SHA.
3. With the env flag off, status still returns `coachEnabled:false` and `decision:BLOCKED`.
4. With the flag on and odds credentials present, a slot should write `research:ncaab:live-inputs:*` and leave forecast counts at 0 until a frozen candidate exists.

## Out of scope for v1

- Adjusted-model trainer / freeze
- Outcome settlement scoring
- Coach mobile unlock / OTA
- Reusing NCAAF conference or availability collectors
