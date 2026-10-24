# Opt-in NCAAF overtime transfer research

This experiment addresses the lack of recorded forward probabilities. It is not
a Coach unlock, production model, transfer-calibration certificate or historical
forecast backfill. The existing v1 path, 30-unique-OT minimum, 10,000 draws and
production gates remain unchanged.

## Evidence review

The 2026 archive initially held 16 overtime games; an independently checked
missing summary raised it to 17. Separate 2025 collection and detailed-summary
recovery yielded 45 overtime games. Original archives retain their season-specific
unverified ruleset labels and actual October 2026 observation times.

The 2025 and 2026 NCAA Rule 3-1-3 overtime articles were compared using the
documents referenced in `ncaafOvertimeTransfer.ts`. The 2025 book is an NCAA-authored
document mirrored by SCCFOA; the 2026 book is hosted by NCAA. After removing page
headers, PDF control characters, whitespace and line-break hyphen spacing, both
articles hash to `7a88d48655dcf8ea6cc7645eeb58f338069ddb525363af64c71ae21a9181aaa5`.
Document-byte hashes are retained separately. This supports testing a common
overtime-procedure regime, not asserting that the seasons' statistical
distributions or full-game rules are identical. In particular, other 2026 rule
changes remain relevant to model validation.

The version `ncaaf-observed-ot-transfer-research-v2` uses 2026-only regulation team
samples and a separate support reference to authenticated 2025 overtime results.
It never edits the original season labels. Each model input freezes both cohorts,
the source references/hashes, the procedural review, the quote and injury receipt
times, and the genuinely current forecast time. Only 2025 support for 2026 targets
is permitted. Earlier years and future seasons require a new review/version.

## Execution and safeguards

```sh
# In the Render API service environment, after the reviewed build is deployed:
node dist/ncaafOvertimeTransferJournal.mjs
node dist/ncaafOvertimeTransferJournal.mjs --execute
```

Default mode reads archives and prepares a plan without provider calls or writes.
Explicit execution guards the database name, takes a dedicated advisory lock,
limits the slate to 128 events, rejects odds or injuries older than six hours,
and checks the database clock again at insertion. It preserves the first
model/event record with `ON CONFLICT DO NOTHING`; it never overwrites v1 records.
The existing file-based journal CLI also verifies any support reference against
the database before allowing a write.

Set `NCAAF_RESEARCH_OT_TRANSFER_ENABLED=true` to opt the existing research worker
into this additional recording step after its normal bounded pipeline run. The
step uses the already captured archives and makes zero additional provider or
paid-odds requests. Existing collection schedules, budgets and settlement delay
are unchanged. The shared settlement scorer explicitly recognizes the new model
version and scores its frozen probabilities. Calibration remains split by model
version; v1 and v2 samples must not be merged to inflate evidence.

Every record retains `researchOnly: true`, `validationReady: false`,
`productionReady: false` and `automaticUnlock: false`. The procedural review
retains `transferCalibrationVerified: false`. No routing, mobile model registry,
recommendation thresholds, user entitlements or NCAAF production gate is changed.

## Provider schedule repair

Historical team schedules can carry a current-season label at the container
level while their individual events correctly identify the requested older
season. Candidate discovery now requires exact team identity and checks each
event's season, completed state and past kickoff. A mismatched or absent event
season still excludes that event. Every recovered result additionally requires
an independently fetched detailed summary with the exact event/season identity
and reconciled period scores. Container metadata alone never admits a result.

## Readback and remaining release requirements

After recording, query `research:ncaaf:ot-transfer:latest` and the new model's
forecast prefix. Verify `recordedAt >= forecastAt`, both before kickoff, the
source hashes, the preserved first probabilities, and zero release eligibility.
After completed games, check matching settlement records and per-model Brier
cohorts. A successful recording step is not an accuracy result.

Production release still requires independently verified exact-quote/line
binding, actual pregame injury/input evidence, at least 500 independent settled
holdout games across two seasons, a verified market baseline, calibration and
source/ruleset/injury review with sign-off. Present archives do not satisfy this
contract. No evidence-backed production release date is established by this
experiment, and today's observations cannot be relabeled as available in 2025.
