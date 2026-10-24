# Prospective NCAAF context development records

The research pipeline assembles immutable pregame development records after conference capture and team-history repair. The new step reads existing archives only: no provider/paid-odds calls. It does not modify any forecast, introduce injury point penalties, fit coefficients automatically or enable Coach.

## Evidence

For each uniquely bound upcoming event, authenticate the conference raw bytes and ESPN identity again using the database clock. Select at most five distinct completed prior games per team from 2026 summary archives observed before the current cutoff. Validate original summary bytes, event/season/team identities, final status, scores and receipt timestamps. Passing attempts, rushing carries and receptions are accepted only when every player count parses and sums exactly to the corresponding source total. Missing or inconsistent groups remain unknown; receptions are not represented as targets or snap counts.

Availability identities require an exact normalized name and jersey match to an unambiguous ESPN athlete ID. Exempt, unmatched or ambiguous players remain unknown. Record observed participation shares separately for available, probable, questionable, doubtful, out, game-time-decision and unknown. At least three complete prior games are required for each participation family. These shares describe observed past participation; they are not impact coefficients, starter determinations or causal injury adjustments.

Neutral-site metadata is captured only when the authenticated ESPN scoreboard explicitly provides a boolean; absent metadata stays null. Freeze a canonical hash/reference to the pregame team-history archive and the allowed prior-game IDs so later opponent/venue experiments cannot silently use future results.

## Immutable inputs and later labels

`research:ncaaf:context-input:v1:2026:<event>` preserves the first pregame record using a final database-clock-before-kickoff INSERT check. Repeated runs preserve existing inputs. Labels use separate `research:ncaaf:context-outcome:*` keys, preserve the first label, hash their exact frozen input and reference the existing settlement. Final labels must authenticate raw summary bytes and agree with the saved event, season, kickoff, teams and scores. Started/future-invalid inputs and inconsistent labels are rejected.

All records are `datasetRole:development_only`; they are not independent holdout games. New availability captured after an existing v2 forecast cannot retroactively turn that forecast into an injury-aware forecast. The existing 29 predictions remain unchanged.

## Run and status

`node scripts/ncaaf-context-dataset.mjs` is plan-only. `--execute` uses the existing production database credentials and an advisory lock, bounds targets to 128 and raw usage archives per target to ten, and saves its status at `research:ncaaf:context-dataset:latest`. The existing opt-in background worker invokes the assembler once per collection slot. Assembly errors are reported without stopping the original forecasting/settlement pipeline.

Fit and held-out testing remain unavailable until genuine completed development examples and a separate, prospectively defined holdout exist. No training metrics, injury effects or acceptance results may be inferred from synthetic tests or unfinished games. The 500-game/two-season, market-baseline, source review and release-signoff requirements are unchanged.
