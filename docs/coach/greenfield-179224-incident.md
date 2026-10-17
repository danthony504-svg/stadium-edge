# Greenfield 179224* incident — grounding + missing sim (2026-10-17)

**Paused:** NCAAF research. **No deploy / OTA.** Production freeze stays armed.

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
| **Coach-events payload** | no `updateId` / `channel` fields today | Cannot bind a Telegram row to preview vs production without device logs |

Both OTAs POST to the same API (`stadium-edge.onrender.com`). Prefer **production `b666165e`** for App Store users; **preview `54b89f32`** for internal IPA.

## Recovered ask / candidates (limits)

Production `reliability_events` / chat transcripts are **not** queryable from this agent (no DB credentials). Inferred from telemetry shape only:

| Ticket | Inferred ask | Candidate IDs | Mappings | Sim / stamps | Delivered picks |
|--------|--------------|---------------|----------|--------------|-----------------|
| 1518210 / 6360124 | 6-leg parlay touching **Rays @ Guardians** (MLB nickname or full label) | Unknown (not in event body) | Alert `affectedGame=Rays @ Guardians`; ESPN abbrs **TB/CLE** (ids 30/5) | Observe-only grounding after ticket finalize | **6/6 returned** — delivery completed |
| 6362208 | 5-leg ask | Unknown | — | `missing_sim_output` ⇔ `GAME_SIMS_FETCH_EMPTY` or `GAME_SIMS_ALL_NULL` (stamp mode now split) | **0/5** — empty ticket |

Live board probe (same day): Odds has `Tampa Bay Rays @ Cleveland Guardians`; ESPN games use `awayAbbr=TB` / `homeAbbr=CLE`; props for that event **count=0**; game-outcome sim returns `engineVersion: sport-sim-v1`.

## Classification

### Grounding (6/6)

| Question | Answer |
|----------|--------|
| Did grounding **reject** bad candidates from the ticket? | **No.** `reportCoachScanReliability` is observe-only — never changes selection / grading / UI. |
| Could mismatched picks reach delivery? | **Yes**, if any leg truly failed player↔game bind — full N/N still ships and still pages. |
| Telemetry mislabel of a good ticket? | **Plausible FP** when feed abbrs like `TBR` or NFL-only fallback tokens met nickname labels `Rays` / `Guardians` after MLB resolve miss. Canonical `TB`/`CLE` already passed MLB nick map; aliases + sport-aware fallback fixed. |

**Policy preserved:** full N/N with a **real** orphan (e.g. NYY on Rays@Guardians) still alerts — tests lock this.

### Missing sim (0/5, ~8.6s)

| Mode | Code | `failureReason` |
|------|------|-----------------|
| HTTP null / throw / empty cover after bind | `GAME_SIMS_FETCH_EMPTY` | `missing_sim_output` |
| Draw present, stamp rejected | `GAME_SIMS_STAMP_REJECTED` (**new**) | `missing_sim_output` |
| Sims loaded, no usable line grades | `GAME_SIMS_ALL_NULL` | `missing_sim_output` |
| Lines dropped / props none cleared | `GAME_LINES_NO_SIM_GRADE` / `PROP_ALL_NO_SIM_GRADE` | `simulation_failure` |
| Empty prop pool | `PROP_POOL_EMPTY` | `alt_market_failure` |
| Budget / missing scan | `ABSOLUTE_BUDGET` / `SCAN_THREW` | `scan_freeze` |

~8.6s fits early slate bind+fetch empty (or stamp reject on preview), not a full timed-out MC slate. Not an unsupported-market code (`PROP_POOL_EMPTY` would be alt_market).

## Fixes (this branch — no OTA)

1. `normalizeTeamAbbr` aliases (`TBR`→`TB`, …) in `resolvePropPlayerSides.ts`
2. Sport-aware grounding fallback (MLB nicks before NFL bucs/browns) in `coachReliabilityGrounding.ts`
3. Tighten `isLikelyPlayerProp` (bare `player` alone insufficient)
4. Stamp reject vs HTTP null in `coachGameMonteCarlo.ts` + `GAME_SIMS_STAMP_REJECTED` in failure reason / classify (mobile + api-server)
5. Regressions: `coachReliabilityGreenfield179224.test.ts` + grounding / scan-failure cases

## User impact

- Users on grounding tickets **received full 6-leg tickets**; Telegram pages may have been **false positives** or true orphan legs that still delivered.
- User on 6362208 got **empty 5-leg** response with missing-sim alert (~9s).
- No gate / OTA change in this turn.
