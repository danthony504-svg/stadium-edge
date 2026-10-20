# Soccer team detail history fix

## Cause

The team detail screen resolves odds-feed team names through `/sports/team-search` before requesting history. That route reused a player-search league allowlist which excluded soccer, so ESPN's exact Sabah FK result (`21922`) was discarded. The UI correctly showed no evidence, even though the provider had results.

The shared history fetcher also used `soccer/uefa.champions` for every soccer club. Direct provider verification returned two completed Sabah matches from that path and ten from `soccer/all`.

## Change

- Team search accepts provider-declared soccer teams and the shared competition-to-sport resolver. Player search remains on its separate supported game-log allowlist.
- The shared team/matchup history fetcher uses ESPN's all-competition soccer schedule, with exact team-ID filtering, completed-match filtering, and an eight-second fetch timeout. Other sports retain their own league paths.
- The same single schedule request replaces the old request; no competition fan-out, background loop or added simulation step.
- Team search and history cache versions advance so old empty/narrow results cannot survive API rollout.
- Tied scores are not losses. Form/record expose additive `draws`; draws break W/L streaks. A current schedule containing only draws does not trigger previous-season replacement. Existing clients can consume the response without an OTA; their existing W-L tiles do not display a separate draw column.
- Missing data still returns honest empty buckets. Odds/lines, entitlement rules, injury reporting, simulation/qualification floors and Coach completion logic are untouched.

## Validation

- Corrected real route handlers, using live ESPN data, resolve Sabah FK to `21922` and return ten completed results. Observed record: 7 wins, 3 losses. This verifies data retrieval, not the current betting price or a recommendation to back Sabah.
- Provider-fixture integration tests cover continental/domestic soccer search, explicit provider sport for an otherwise unmapped competition, unchanged NBA mapping, unknown leagues, exact team identity, scheduled-game exclusion, draws/streaks, all-draw current seasons, bounded fallback and cache reuse.
- API bundle passes. Required reliability tests pass (502 checks including four soccer checks). Full API typecheck still reports existing repository errors; normalized comparison with the preceding baseline shows no new diagnostics.

## Rollout

This fix is API-only. Deploy the merged commit on Render, then verify `/api/sports/team-search?query=Sabah%20FK` and `/api/sports/team-history?sport=soccer&teamId=21922`. No OTA or native build is required for this fix. Already-open detail queries may retain the previous empty result for the existing client cache period (10–30 minutes); a full app relaunch clears the in-memory query cache. No production deployment is claimed by this document.
