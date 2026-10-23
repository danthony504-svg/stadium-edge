# Coach scan load repair — 23 October 2026

## Observed failure

Two phone reports ended with `scan_deadline`: 49,321 ms total / 27,415 ms load,
and 41,618 ms total / 36,082 ms load. Production logs confirm both request IDs.
During the second request window the props and PrizePicks routes repeatedly
returned HTTP 429 while the client continued retrying them. The logs share a
time window, not per-request tracing for each individual GET.

## Repair

- Prop GETs stop retrying after a 429 and share a route-specific cooldown across
  sports and event IDs. Honor Retry-After seconds or HTTP dates; use the existing
  server's 60-second bucket window when absent. This stores no odds and does not
  change server rate limits. Other GET routes retain their retry behavior.
- A completed full prop-board attempt is not repeated merely because it produced
  fewer than 40 priced selections, including zero. New Coach requests still load
  current boards after backpressure expires.
- Live odds and prop loading overlap. The loader still waits for live data before
  returning, preserving the existing current-state gates.
- Game-line-only asks perform no player-prop event requests. Existing NCAAF
  player-prop scope exclusions run before event fetching rather than only after.
  The game-line board and allowed full prop ladders are retained.

No confidence/grade floor, price, simulation count, period exclusion, entitlement,
or NCAAF validation gate changes.

## Verification and release limits

36 targeted tests pass, including actual loader sequencing with a delayed live
feed, no prop calls on a game-line-only request, 429 network call counts,
cooldown expiry/isolation, and scope checks across all ten sports. Reliability
critical tests and mobile typecheck pass. The iOS Hermes bundle exports locally.

These are source/regression checks, not a measured premium phone speed pass.
Production OTA publishing is separate; the repository workflow requires a
TestFlight cold-launch pass. NCAAF remains locked. Current source already reports
that policy block as `blocked_unvalidated_market`; the earlier screenshot's
`odds_mismatch` label is not proof that current provider quotes are unavailable.
