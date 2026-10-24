# NCAAF pipeline rebuild: operational stages and model lifecycle

The collection workflow was not a production release pipeline. It recorded a basic research candidate, while availability/opponent/venue development was separate and neither a fitted adjusted trainer nor an approved model-to-Coach handoff was registered. Accumulating old forecasts could not make those missing components appear. This rebuild explicitly distinguishes operational task completion, authenticated development examples, prospective model protocol and independent release approval.

## Implemented operational changes

The background worker now runs an independent lifecycle coordinator, outside Coach requests. Settlement, label maintenance, development preparation and research metrics run before potentially slow collection; a settlement-only mode avoids entering any collection phase. Phase claims and progress are durable, including during a worker termination. It uses a dedicated advisory lock and durable stage records. The existing collection/settlement workflow retains its locks, paid-odds limits, source identity checks and immutable forecasts. A failure or completed collection slot cannot prevent the independent OT research journal, label maintenance, development preparation or descriptive metrics refresh.

Label maintenance runs at most once per 30 minutes, with a claim written before work even on failure. `ncaaf-context-dataset.mjs --labels-only --execute` bypasses collection/source assembly and processes cached settlements only. It has a separate status and cursor, preserving collection reports. No network request or paid odds call is added by labeling or development preparation. The existing notification cron triggers background work every 15 minutes; the existing collection slots remain unchanged.

`ncaaf-prepare-development.mjs --execute` reads at most 1,024 v2 inputs and their exact immutable labels. It rederives conference availability, event identity and participation features from the original archived sources at the original cutoff, authenticates the final summary and source history, verifies the exact input/label hashes, rejects future/target-game history, and deduplicates season/event identities. Unknown usage or venue stays unknown; no impact coefficients or healthy-player assumptions are created. The prepared manifest contains references and hashes, not athlete rows. It is content-addressed, development-only and not holdout evidence. Above the batch limit preparation fails explicitly and requires partitioning rather than silently dropping examples.

A frozen protocol helper fixes model hash, implementation commit, training-game exclusion list, feature version, exact full-game markets, 10,000 simulations and the existing 500-game/two-season requirements. Holdout guards reject training reuse, changed model/protocol hashes, forecasts before the model freeze, late writes, development relabeling and lower simulation counts. These helpers do not themselves certify a trained model, authorize production or register a live model. They are the boundaries the future adjusted trainer/journal must use.

`/api/research/ncaaf/status` provides sanitized live inventory, task status and explicit model/release blockers; it is linked from the research preview. Counts are descriptive research counts, not qualified independent holdout counts. Unknown qualification remains null rather than being presented as passed. Reads are bounded/coalesced/cached and make no provider calls. Model fit, holdout evaluation and Coach integration remain explicitly unavailable until implemented and evidenced; successful collection is never labelled model validation.

## Still required for a full Coach rebuild and release

1. Obtain completed, authenticated development examples with adequate signal variation.
2. Implement, fit and review the adjusted score/distribution model using those examples. No injury penalty, coefficient or effect is invented by this change.
3. Freeze that actual model artifact and register its prospective protocol, including every training/source game that must be excluded from holdout.
4. Wire a separately versioned forward journal and exact-market inference to the frozen artifact. Preserve every prior research forecast; do not relabel old predictions as injury-aware or as new-model holdouts.
5. Score independent qualifying forecasts against authentic outcomes/market baselines and complete calibration, conservative missing-data, opponent/venue, OT and source reviews.
6. Meet the existing 500-game/two-season acceptance requirement. A newly created model cannot fabricate prior-season forecasts; this remains a calendar/evidence constraint, not a deployment task.
7. Register the approved artifact in server inference and coordinate the corresponding mobile gate/configuration change, run Coach regressions and controlled rollout, then monitor. Mobile code changes require an OTA; no new native build is authorized here.

No Coach gate, grade/confidence floor, subscription rule, football-period restriction or accepted model registry entry is changed by this operational rebuild. This is not a full unlock, not a fitted model and not validation evidence. Remaining work above must not be reported as completed.

## Verification

Focused tests cover failure isolation, durable retry cadence, overlap/database guards, exact input/final/history binding, unknown features, plan-only labeling, hash-stable model protocols, training/holdout leakage and unchanged release thresholds. API typecheck/build and full API regressions run before deployment. Live verification checks the new coordinator/status, preservation of the original forecast fingerprint and unchanged Coach gate.
