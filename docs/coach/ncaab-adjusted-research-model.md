# NCAAB adjusted research model

Research-only. Separate from NCAAF. **Does not unlock Coach.** Product engine `ncaab-score-v2` is never a freeze source.

## Trainer

- `trainerVersion`: `ncaab-context-ridge-research-v1`
- `featureVersion`: `ncaab-odds-score-features-v1`
- Features (7): intercept, home spread line, total line, home/away ML implied, home/away spread prices
- Label: regulation points minus market baseline `(T∓L)/2`
- Ridge `4`, centered/scaled; score support `0..200`
- Fit floor: `featureNames.length + 2` = **9** feature-complete development games
- Signal guards: identifiable range on spread line, total line, and ML implieds
- Limitations recorded on the artifact; `researchOnly:true`, `releaseEligible:false`, `coachEnabled:false`, `validationReady:false`

## Development prepare

`scripts/ncaab-prepare-development.mjs` builds `research:ncaab:context-input:v1:*` + `context-outcome:v1:*` from:

1. Earliest pre-kickoff `research:ncaab:live-inputs:*` matched row with reconstructible primary ml/spread/total
2. Authenticated ESPN mens-college-basketball final via `ncaab-bind-final-summary.mjs`
3. Immutable content hashes (`inputSha256` ↔ label)

No injuries, usage, or invented venue. Incomplete odds → `featureComplete:false`.

## Freeze

`attemptNcaabResearchFreeze`:

- Waiting states (`waiting_for_verified_development_finals`, `waiting_for_more_development_games`, `waiting_for_signal_variation`, `waiting_for_implementation_commit`) set `modelSha256:null` and never write `context-model:artifact:*` / `first:v1`
- On successful fit: first-write-wins artifact + pointer under `research:ncaab:context-model:*`
- Rejects any `ncaab-score-v2` / product-sim token
- Implementation fingerprint hashes **NCAAB-only** source files (never NCAAF frozen `SOURCE_FILES`)

## Journal

After freeze, `recordNcaabAdjustedForecasts` writes prospective `research:ncaab:forecast:*` only for future kickoffs excluded from `trainingGameIds`/`excludedGameIds`, before kickoff, with settlement-compatible ml/spread/total probabilities. Existing settlement scorer grades them after verified finals.

## Release floors (unchanged)

- **500** independent holdout games across **≥2** seasons
- Calibration / quality reviews
- Human approval
- Coach remains blocked; no OTA from this work
