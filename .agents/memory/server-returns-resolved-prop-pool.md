---
name: Server streams resolved prop pool back to client matcher
description: Why the mobile chat SSE returns a {props:[...]} frame and the client merges it before parsePicks
---

# Server returns its resolved prop pool to the client matcher

The mobile Coach matcher (`parsePicks` in components/PickCard.tsx) resolves AI prop
PICK lines against the CLIENT's `propPool`, which is built from only the soonest
prop-capable games (api.ts: propCandidates sorted soonest-first, sliced to
MAX_PROP_CONTEXT_GAMES). On a busy multi-sport slate the LATEST-starting games (the
"later games" a user asks for) get trimmed, or are dropped by a burst-429 / fallback
eventId. The SERVER meanwhile feeds the model those props anyway (realOdds covers all
pickable games + the market-lock fresh-fetch backfill in chat.ts), so the model emits
perfectly real later-game prop legs the client never fetched → `parsePicks`
fail-closes every one → 0 legs → the "I couldn't ground any of those legs" fallback.

**Rule:** whatever prop pool the server feeds the model, it MUST also be reachable by
the client matcher. The chat route now streams `lockedContext.realProps` (post-filter
/ post-backfill) as a `{props:[...]}` SSE frame emitted right after the status frame
and BEFORE the first content token. `streamChat` parses `.props` via an optional
`onProps` callback; coach.tsx converts with `propPoolFromRealProps` (RealPropEntry →
PropPoolEntry, one row per posted side) and merges into `mergedPropPool` (client pool
wins on collision to keep headshot/teamAbbr; dedup key game|player|line|side|marketLabel)
before parsePicks.

**Why:** never-fabricate is preserved because the server rows are real bookmaker data
from the same /sports/props feed. realOdds is NOT capped to 24 client-side, so only
PROPS need this — game-level later-game legs already resolve.

**How to apply:** any future server-side prop filtering/backfill (period markets, new
market locks) is automatically covered since it flows through lockedContext.realProps.
Unknown SSE frames are ignored by older clients and the web app (backward-compatible),
so emitting the frame is safe. matchProp tolerates raw market keys ("batter_home_runs")
vs the friendly label ("Home Runs") via token overlap, so the converter using
propMarketLabel matches cleanly.
