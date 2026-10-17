# mobile-rc incident 3645 — Rays @ Guardians / abbr cover / stamp / delivery grounding

## Base

- Worktree branch: `cursor/mobile-rc-incident-3645`
- Base tip: `54b89f32` (preview)
- Incident ports from `/workspace` tip `676f941d`
- **No OTA** in this change set — code + tests + docs only

## Preserved (do not regress)

- `coachReliabilityReporter` / `buildParlay`: `deliveryCommitted: false` on assembly reports; UI delivery-commit owns `parlay_fulfilled`; cancelled + fulfilled-once-per-requestId dedupe
- `gameSimScoring`: `gameDrawEngineAccepted` stamp gate, `coverQueryStatus`, `simCoverRateMap` (coverHitRates / coverProbs)
- `propContextPipeline` opponent-cache path (unchanged)
- Existing stamp accept checks in `coachGameMonteCarlo` (post-fetch `gameDrawEngineAccepted`; cache predicate arg retained)
- NCAAF validation / P0_UNVALIDATED_MARKETS flags **not** touched

## Incident ports

1. **resolvePropPlayerSides** — `TEAM_ABBR_ALIASES` + `normalizeTeamAbbr` (TBR→TB); export `teamAbbrMatchesTeamName`
2. **coachReliabilityGrounding** — sport-aware MLB nick before NFL tokens; unknown ≠ mismatch; tighter `isLikelyPlayerProp`
3. **gameSimScoring** — abbr bind in `sideOfTeam`; ML fallback requires finite matching-side prob (never invent 0.5 / opposite)
4. **coachTeamIdResolve** — sport-aware MLB TB→rays nick keys; NFL TB stays bay
5. **coachGameMonteCarlo** — `stampRejected` status split; default ML covers via `buildDefaultGameCoverQueries` when posted lines yield zero queries
6. **coachScanFailureReason** / **coachReliabilityClassify** / api-server sanitize — `GAME_SIMS_STAMP_REJECTED` → `missing_sim_output`
7. **coachDeliveryGrounding** — strip proven mismatches, qualified refill, honest shortfall
8. **buildParlay** — `applyDeliveryGroundingGate` after final belts (props-only + main) before shortfall notes; enrichment fields on reliability reports
9. **coachReliabilityReporter** — enrichment fields + OTA resolve on POST; deliveryCommitted semantics unchanged
10. boardMarketScanner counts `gameSimsStampRejected`

## Tests

- `lib/coachRaysGuardiansIncidentE2E.test.ts` (paired suite)
- `lib/coachDeliveryGrounding.test.ts`
- `lib/gameSimAbbrCoverQuery.test.ts`
- `lib/coachReliabilityGreenfield179224.test.ts`
- Existing reporter / engineVersion / scan-failure regressions extended for STAMP + enrichment
