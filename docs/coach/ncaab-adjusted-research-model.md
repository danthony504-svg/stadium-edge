# NCAAB adjusted research model (freeze path)

Research-only. Separate from NCAAF. **Does not unlock Coach.**

## Current state (2026-10-30)

Production `GET /api/research/ncaab/status` reports:

- `adjustedModel.state = not_fitted_or_registered` (or an explicit waiting state after this coordinator lands)
- `modelSha256 = null`
- `coachEnabled = false`, `releaseEligible = false`
- No development manifest under `research:ncaab:development-*`
- Product engine `ncaab-score-v2` remains seating/sim infrastructure only

## Freeze coordinator

`attemptNcaabResearchFreeze` writes `research:ncaab:adjusted-model:latest` with honest waiting states:

| State | Meaning |
|---|---|
| `waiting_for_verified_development_finals` | No authenticated `development-dataset:latest` / manifest |
| `waiting_for_more_development_games` | Manifest exists but feature-complete examples &lt; 23 |
| `waiting_for_ncaab_research_trainer` | Enough development volume, but basketball ridge trainer not implemented |
| `frozen_candidate_preserved` | Immutable `context-model:first:v1` already exists |

It **never** writes a new `modelSha256` in this revision. It **rejects** freezing `ncaab-score-v2` or any product-sim token into the research pointer.

## Still required before a real freeze

1. Basketball context/feature pipeline (`research:ncaab:context-input:*` + authenticated finals) — do not reuse NCAAF conference/availability collectors.
2. `ncaab-prepare-development` → content-addressed `development-manifest` + `development-dataset:latest`.
3. Implemented `ncaab-context-ridge-research-v1` trainer with implementation fingerprint, training exclusions, OT/extra-period policy, and protocol seal (500 independent games × ≥2 seasons remain holdout floors, not fit substitutes).
4. First-write immutable artifact + `context-model:first:v1` pointer (`researchOnly:true`, `releaseEligible:false`).
5. Only then: prospective forecast journal → existing settlement scorer.

## Explicit non-goals

- Subscriber Coach enablement / OTA
- Relabelling product sims or live-input archives as independent holdout
- Importing NCAAF journal/scorer modules into the NCAAB freeze surface
