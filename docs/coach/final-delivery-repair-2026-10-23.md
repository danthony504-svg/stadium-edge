# Coach final delivery repair — October 23, 2026

## Confirmed failure

A five-leg phone request completed in 19 seconds. Its private audit recorded five
selected prop quotes but only four distinct player/stat/side ladders. Final
player/game grounding refilled a short ticket by quote fingerprint after the
staging correlation and request-scope checks. A different threshold or sportsbook
therefore re-entered as a seat. The UI removed that duplicate too late. The same
refill could bypass same-player exposure, per-game caps, and preceding ask belts.
No private production rows or archives are included here.

## Changes

- Final grounding applies the existing ladder, participant, same-game prop,
  game-line, opposite-side, and team-total constraints to incoming and replacement
  seats. Explicit single-event ceilings remain separate from generic slate caps.
- Participant comparisons use provider athlete ids within a sport when available,
  retaining name comparison when provider identity is incomplete.
- Replacement pools pass the same requested market, team, excluded-team, slate,
  sport, prepared-delivery, quality, price and simulation-evidence gates.
- Every builder return (including recovery/partial paths) rechecks quality,
  unvalidated-market blocks, exact prop source/evidence and terminal correlation.
  A previously attached qualified stamp cannot override changed evidence.
- Audits expose final builder delivery count and prop keys, with explicit terminal
  constraint rejection reasons. UI cancellation/absolute flush remains a separate
  delivery lifecycle; the report does not certify device rendering.
- Terminal constraint shortfalls do not claim every excluded candidate failed its
  AI quality score. No new fetches, simulations or retries are introduced.
- Four Fantasy screens import the exact Feather family rather than the entire
  icon barrel, avoiding unrelated fonts in the OTA payload.

## Validation and limits

- 83 targeted delivery, audit, correlation, request-integrity, single-event and
  OTA payload tests pass. Anonymous final-refill fixtures cover NBA, WNBA, NCAAB,
  NFL, NCAAF, MLB, NHL, soccer, tennis and UFC. These prove shared policy behavior,
  not live market availability or model calibration for each sport.
- Release-critical suite passes; mobile typecheck passes.
- Full API run: 720 pass, 0 fail, 12 skip.
- Full mobile discovery before the font fix: 2,141 pass, 49 fail, 1 skip (2,191
  tests). Unchanged main comparison: 2,130 pass, the same 49 failures, 1 skip.
  This is not a fully green mobile release certificate. Existing failures include
  no-op PickCard test-stub behavior, fixtures without exact-market simulation
  provenance, stale expectations, and an unconfigured live terminal harness.
  Their remaining classification must not be represented as production validation.
- NCAAF production game-line simulation remains locked. The independent settled
  multi-season, source/ruleset, injury/opponent/venue and signoff requirements are
  not satisfied by these ticket-assembly tests or archived odds.
- No native build or production OTA is implied by a source merge. A new OTA must
  contain this commit; the previous phone update cannot contain a later repair.
