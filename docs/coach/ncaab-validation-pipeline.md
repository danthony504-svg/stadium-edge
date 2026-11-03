# NCAAB research validation pipeline

Separate from NCAAF. Captures prospective NCAAB live inputs, prepares development examples, fits/freezes an odds-ridge research candidate when evidence passes, journals prospective holdouts, and settles saved forecasts against authenticated ESPN finals. **Does not unlock Coach.**

## Principles

- Keys live under `research:ncaab:*` only — never read or rewrite `research:ncaaf:*`.
- `coachEnabled` / `releaseEligible` remain false until an independent multi-season holdout and human signoff exist.
- `ncaab-score-v2` is product-sim infrastructure, not a release-approved model and not a freeze source.
- Development examples and independent holdouts must stay distinct; old predictions are never relabelled.

## Activation

Set `NCAAB_RESEARCH_PIPELINE_ENABLED=true` on the API service. Uses existing `DATABASE_URL` and `ODDS_API_KEY`. API boot and the notification cron enqueue `ncaabResearchWorker`.

## Stages

1. Settlement — unsettled forecasts with kickoff ≥4h earlier; ESPN summary bind + `scoreNcaabRecordedForecast`; first-write-wins; batch ≤64; ≤1 run / 30 min.
2. Live-input capture — Odds API `basketball_ncaab` + ESPN scoreboard identity.
3. Development prepare — `ncaab-prepare-development.mjs` authenticates completed examples from live archives + finals.
4. Freeze — `attemptNcaabResearchFreeze` fits only when ≥9 feature-complete games pass signal guards; waiting states never invent `modelSha256`.
5. Journal — prospective forecasts for future excluded games only; blocked until freeze exists.

Release floors: **500** independent games × **≥2** seasons, quality reviews, human approval.

## Verification

1. Confirm `/api/healthz` SHA.
2. Status stays `coachEnabled:false` / `decision:BLOCKED`.
3. Settlement `processed` with allowlisted blockers only.
4. `adjusted-model:latest` is either an explicit waiting state with `modelSha256:null` or a preserved/frozen research candidate with `releaseEligible:false`.

## Out of scope

- Coach mobile unlock / OTA
- Reusing NCAAF conference collectors or importing NCAAF journal/scorer modules
- Treating `ncaab-score-v2` as a research freeze
- Waiving the 500×2-season independent holdout bar
