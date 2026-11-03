# NCAAF / NCAAB Coach enablement audit (2026-10-26)

**Decisions:** NCAAF **BLOCKED**. NCAAB **BLOCKED** (no validated release).  
**Actions not taken:** no subscriber unlock, no Render deploy from this agent, no OTA, no notifications.

## Deployed baseline (verified live)

| Surface | Evidence |
|---|---|
| Backend `/api/healthz` | `deploymentSha=a0e7dc3975920d2e88f72ed4fece31ec7bce063e` (2026-10-26) |
| NCAAF `/api/research/ncaaf/status` | `coachEnabled=false`, `releaseEligible=false`, holdoutFunnel present |
| Inventory | development 24 / authenticated 24; frozen model `5c244f36…` on 23 games; **independentHoldoutForecasts=0**; **futureHoldoutContexts=0** |
| Holdout funnel | upcomingMatched=52; verifiedAvailabilityBindings=**0**; blockers `missing_or_ambiguous_event=26`, context `conference_stale_or_future_capture=4` |
| Mobile P0 | `NCAAF_GAME_LINE_SIM_VALIDATED=false` in `coachP0UnvalidatedTotals.ts` |
| Repo tip at audit | `9847b72e` (main) |

## Access gates

### NCAAF

| Gate | Side | Reason / effect |
|---|---|---|
| `NCAAF_GAME_LINE_SIM_VALIDATED=false` | mobile | Blocks spread/ML/alt/period game lines; `unvalidated_ncaaf_game_line_simulation` |
| Bare college ask → gameLinesOnly → P0 early exit | mobile | No ticket; props still available when opted in |
| Football period exclusions | mobile | Period markets unsupported for seating |
| `ncaafPipelineReadiness` / research status | server | Always `coachEnabled=false`, `releaseEligible=false`; 500 games × 2 seasons |
| Historical acceptance | server | Multiple unverified provenance / human_signoff reasons |
| Frozen candidate | server | `validationReady=false`; does **not** authorize unlock |

### NCAAB

| Gate | Side | Notes |
|---|---|---|
| No research/release pipeline | — | No holdout ledger, no adjusted-model freeze, no approval artifact |
| No mobile P0 game-line kill switch | mobile | Product may already seat NCAAB game lines via `ncaab-score-v2` — **not** a validated release |
| Props catalog | server | Markets exist when books post; live probe 2026-10-26: **0/7** events had player props |
| Period team stats | server | NCAAB excluded from period-stats feed |

## Models

| Sport | Validated approved model for Coach? | Proof |
|---|---|---|
| NCAAF | **No** | Frozen research candidate `5c244f3632ca99df222223e5bdb04d18d6c93e05ffe63556191367584c07d1a2` trained on 23 development games only; 0 independent holdout forecasts; release stage `blocked` |
| NCAAB | **No** | Engine id `ncaab-score-v2` is product-sim infrastructure only; no validation report / version approval |

## Root causes (NCAAF research funnel)

1. **Conference availability not bound to upcoming slate** — HD Intelligence reports do not authenticate to current matched events (`missing_or_ambiguous_event`), so verified bindings stay 0. This is source evidence lag/mismatch, not a waiver.
2. **Usage capture depended on verified bindings** — with 0 bindings, the collector previously could still throw `usage_history_missing` and surface as `pipeline_collector_failed`. Fixed to wait cleanly.
3. **Completed odds slots skipped usage refresh** — free mid-slot path refreshed injuries/conference/context but not usage. Fixed to run ESPN-only usage after conference free refresh.
4. **Zero prospective holdout contexts** — adjusted journal correctly waits (`waiting_for_holdout_contexts`); no independent forecasts may be recorded until future holdout contexts exist with exact pregame identities.

## Code changes in this PR

- `scripts/ncaaf-capture-usage.mjs` — `waiting_for_verified_availability_bindings` short-circuit (no false collector failure).
- `ncaafValidationPipeline.ts` — free-refresh path also runs usage capture.
- `ncaafPipelineReadiness.ts` — `collectionEvidence` + explicit `coachEnablementDecision: BLOCKED`.
- `ncaabCoachReadiness.ts` — independent NCAAB BLOCKED decision (does not mirror NCAAF).
- Tests updated/added; floors/gates remain closed.

## Live market probes (2026-10-26, America/Chicago afternoon)

| Sport | Odds events | Game lines | Player props | Quick prop sim |
|---|---|---|---|---|
| NCAAF | 56 | h2h/spreads/totals + periods/alts present | 66–164 on sampled events | quick path responded (~346ms wall for 1 prop / 1k sims); deep 10k policy unchanged in code |
| NCAAB | 7 | h2h/spreads/totals present | **0** props on all 7 events | N/A (no prop rows) |

Missing evidence stays unknown (no invented ESPN ids, injuries, or usage).

## Latency

| Measurement | Value |
|---|---|
| NCAAB props probe per event | ~264–810ms |
| NCAAF props fetch (sample) | ~521ms |
| NCAAF quick 1-prop simulate | ~346ms |
| Coach candidate limits | unchanged (none added) |

## Remaining blockers to unlock

### NCAAF → still BLOCKED until

1. Conference reports publish and bind (`verifiedAvailabilityBindings > 0`) for upcoming games.  
2. Holdout contexts with future kickoff + exact pregame odds/injuries/usage.  
3. ≥500 independent holdout forecasts across ≥2 seasons, settled, calibrated.  
4. Human Phase E / release approval.  
5. Flip `NCAAF_GAME_LINE_SIM_VALIDATED` only after that evidence (separate mobile/OTA decision).

### NCAAB → BLOCKED for validated release until

1. Dedicated NCAAB research/holdout pipeline (do not reuse NCAAF).  
2. Approved model version + multi-season holdout metrics.  
3. Human release approval.  
4. Optional: arm an explicit mobile fail-closed gate until then (not published via OTA in this work).

## PASS / BLOCKED

| Sport | Decision | Safe to enable Coach today? |
|---|---|---|
| **NCAAF** | **BLOCKED** | **No** |
| **NCAAB** | **BLOCKED** | **No** (no validated approval; props absent on current slate) |
