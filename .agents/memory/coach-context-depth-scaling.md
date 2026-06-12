---
name: Coach context depth scaling
description: Mobile AI Coach scales how much real slate data it sends the model to the requested ticket size, to fix slow/stuck big "tonight" builds.
---

# Coach context scales to ticket size

A generic mobile-Coach "build me a 6-leg parlay for tonight" (no focal game)
assembled the FULL slate into one chat request — a ~0.5 MB serialized context
(400 props / 120 odds / 17 games / 40 player game-logs / 16 matchups). The
reasoning model is slow to first token on that much data, and on a weak link the
client stall-watchdog aborts and re-sends the whole payload, so the build sits on
"Building your parlay…" indefinitely. (Production focal builds are tiny —
realGames:1, ~85KB — because naming a game self-limits the slate.)

**Rule:** the amount of real data sent to the model is a function of the
requested leg count, NOT a fixed max. `contextDepthForLegs` (pure, in
`chatContextPriority.ts`, unit-tested) returns `{props,odds,history,matchup}`
tiers: 2-5 legs = focused, 6-10 = medium, 11+ = full; no explicit count (0)
falls back to the MEDIUM tier. `buildChatContext` takes `requestedLegs` and
applies the depth to its FOUR breadth sinks: props cap (`balancePropsByGame`),
non-period `ODDS_CAP`, `prioritizePlayerHistoryTargets` cap, and the
`matchupCap` on `buildMatchupHistoryAndUpsets`.

**Why:** big tickets MUST stay full-breadth — the slate is heavily tuned against
parlays coming back short (see big-parlay-prop-fetch-cap, mobile-chat-prop-breadth).
Only small/medium tickets shrink, where the smaller pool is still far more than
enough to fill the requested legs. This cuts upload bytes + model time-to-first-token.

**The dominant per-item cost is matchupHistory.** Measured on the wire (api-server
logs the serialized context size), each matchup entry is ~15 KB (recent-game /
h2h / L10 arrays) vs ~3 KB per player game-log and ~0.5 KB per prop. A first-pass
"medium" tier (280/90/28/12) was still ~367 KB ≈ ~90K input tokens, and the model's
time-to-first-token still outran the stream watchdog → abort-and-resend loop. So
the tiers cut **matchup hardest** (it's analytics for winner/upset reads, NOT the
source of PICK lines, which come from realProps+realOdds — safest to trim), history
next, with a props/odds floor that still fills the legs. Current tiers: small
(80/45/10/3), medium (110/55/16/4) ≈ ~120 KB, full (cap/120/cap/16). When tuning,
prefer cutting matchup before props — props/history under-fill is far more visible
to the user than thinner matchup analytics.

**How to apply / gotchas:**
- Period / same-game high-leg builds keep `ODDS_CAP = 400` (the `includePeriods`
  override stays) so the period ladder survives — depth only governs the
  non-period odds branch.
- The decoupled upset-only caller of `buildMatchupHistoryAndUpsets` keeps the
  default cap (16); only the in-context call passes `depth.matchup`.
- Focal/named-game builds are already small; scaling is a harmless no-op there.
- If you add a NEW breadth sink to `buildChatContext`, scale it by `depth` too or
  it silently re-introduces the full-payload slowness for small builds.
