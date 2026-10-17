# Greenfield 179224* incident — grounding + missing sim (2026-10-17)

**Paused:** NCAAF research. **No deploy / OTA.** Production freeze stays armed. Voice paused.

## Ticket identity

| requestId | UTC (from id) | Alert | Legs | durationMs |
|-----------|---------------|-------|------|------------|
| `greenfield-1792241518210` | 2026-10-17T12:51:58.210Z | player_game_grounding_mismatch · Rays @ Guardians | 6/6 | 63805 |
| `greenfield-1792246360124` | 2026-10-17T14:12:40.124Z | same grounding | 6/6 | 55837 |
| `greenfield-1792246362208` | 2026-10-17T14:12:42.208Z | missing_sim_output | 0/5 | 8615 |

## Mobile update / channel + server SHA

| Layer | Value | Notes |
|-------|-------|-------|
| **Server** | `e607f131898daebaecd08602558905b96f738122` | `GET /api/healthz` `deploymentSha` (verified 2026-10-17) |
| **Production OTA** | channel `production` · update group `68de9f95-…` · message SHA `b666165e…` (Build 78 / runtime 1.1.0) | Includes grounding reporter; **no** `gameDrawEngineAccepted` in slate fetch |
| **Preview OTA** | channel `preview` · group `dd669b36-…` · SHA `54b89f32…` | Includes grounding **and** stamp gate on slate sims |
| **Coach-events payload (this branch)** | `updateId`, `channel`, `bakedSha`, `requestScope`, `candidateIds`, `gameIds`, `simFailureReason` | No credentials / personal data |

Both OTAs POST to the same API (`stadium-edge.onrender.com`). Prefer **production `b666165e`** for App Store users; **preview `54b89f32`** for internal IPA.

## Recovered ask / candidates (limits)

Production `reliability_events` / chat transcripts are **not** queryable from this agent (no DB credentials). Inferred from telemetry shape only. Tests are **incident-derived fixtures**, not exact replays.

| Ticket | Inferred ask | Candidate IDs | Mappings | Sim / stamps | Delivered picks |
|--------|--------------|---------------|----------|--------------|-----------------|
| 1518210 / 6360124 | 6-leg parlay touching **Rays @ Guardians** (MLB nickname or full label) | Unknown (not in event body) | Alert `affectedGame=Rays @ Guardians`; ESPN abbrs **TB/CLE** (ids 30/5) | Observe-only grounding after ticket finalize (pre-gate) | **6/6 returned** — delivery completed |
| 6362208 | 5-leg ask | Unknown | — | `missing_sim_output` ⇔ `GAME_SIMS_FETCH_EMPTY` / `ALL_NULL` / `STAMP_REJECTED` | **0/5** — empty ticket |

## Classification

### Grounding (6/6)

| Question | Answer |
|----------|--------|
| Did grounding **reject** bad candidates from the ticket? | **Pre-fix: No** (observe-only). **This branch: Yes** via `applyDeliveryGroundingGate` after final belts. |
| Could mismatched picks reach delivery? | **Pre-fix: Yes.** **This branch: No** for *proven* mismatches; unknown identity stays. |
| Telemetry mislabel of a good ticket? | **Plausible FP** when feed abbrs like `TBR` or NFL-only fallback tokens met nickname labels `Rays` / `Guardians`. Aliases + sport-aware fallback fixed. |

**Policy preserved:** full N/N with a **real** orphan (e.g. NYY on Rays@Guardians) still alerts — and delivery now strips that leg (replace only from qualified grounded candidates; honest shortfall).

### Missing sim (0/5, ~8.6s)

| Mode | Code | `failureReason` |
|------|------|-----------------|
| HTTP null / throw / empty cover after bind | `GAME_SIMS_FETCH_EMPTY` | `missing_sim_output` |
| Draw present, stamp rejected | `GAME_SIMS_STAMP_REJECTED` | `missing_sim_output` |
| Sims loaded, no usable line grades | `GAME_SIMS_ALL_NULL` | `missing_sim_output` |

**Root cause (reproduced):** MLB abbr picks (`TB ML`, `CLE +1.5`) failed `buildGameCoverQuery` / `sideOfTeam` → empty cover queries (false `FETCH_EMPTY`) or null grades (`ALL_NULL`) even when ESPN ids bound. Stamp split remains for preview OTA diagnosis.

## Fixes (this branch — no OTA)

1. `normalizeTeamAbbr` aliases + sport-aware MLB grounding (`resolvePropPlayerSides`, `coachReliabilityGrounding`)
2. Stamp reject vs HTTP null (`coachGameMonteCarlo`, `GAME_SIMS_STAMP_REJECTED`, mobile + api classify)
3. **Delivery gate** `coachDeliveryGrounding` wired in `buildParlay` (props-only + main)
4. **Abbr cover-query bind** in `gameSimScoring.sideOfTeam` + default ML cover fallback when posted lines yield zero queries
5. MLB sport-aware `coachTeamNickname("TB")` → `rays` (NFL keeps `bay`)
6. Reliability enrichment: `updateId` / `channel` / `bakedSha` / `requestScope` / `candidateIds` / `gameIds` / `simFailureReason`
7. Land `gameSimEngineVersion.ts` (stamp gate import)
8. Incident-derived fixture labels (not exact replays)

## Isolation

- Branch: `cursor/coach-grounding-mlb-sim-3645` only — **no** NCAAF archive / research / tuning commits.
- NCAAF remains blocked; production freeze; voice paused; **no deploy / OTA**.

## User impact

- Grounding tickets: mismatched legs no longer ship; shortfall is honest when refill cannot recover.
- 0/5 missing-sim path: abbr game lines can bind and grade; stamp vs fetch remains distinguishable in telemetry.
- Coach-events can bind Telegram rows to OTA channel + baked SHA without PII.
