---
name: matchup-history bumps in live parlay scorer
description: How real ESPN-derived team form (L10) and H2H signals layer on top of the live-margin/pacing scorer without dominating it.
---

# Form/H2H bumps are a SECONDARY signal — keep them capped

The live parlay scorer's primary inputs are live margin, pacing, period progression, and market-implied probability. Form (L10 W-L, avg margin, pts for/against) and H2H (last 5 meetings) are layered on top via small, capped bumps.

**The rule:** combined history bump on any single leg must stay below the magnitude of the strongest live signal. Today: ML form is ±10, ML H2H is ±5, spread form is ±8, total pace is ±8 — combined ML max ±15, which is below live-margin's max ±28.

**Why:** an earlier draft used ±8 for H2H on top of ±10 for form, giving a combined ±18 that could materially steer ranking in pre-game / low-live-context moments. History is a tiebreaker, not a driver.

**How to apply:** when adding any new history-derived bump, sum the worst-case across all history branches for a single leg and keep it strictly below the dominant live-signal cap for that market.

## Endpoint shape (for future reuse)
`/api/sports/matchup-history?sport=&homeTeamId=&awayTeamId=` returns `{home, away, h2h}` with last10/last5 form blocks and a meetings array — all values null when a feed is empty (no fabrication). 15-min TTL via the in-memory cachedJson. Player-history endpoint exists but is NOT wired to props yet — wiring it requires a per-sport athlete-ID + stat-label normalization layer first, because PrizePicks player names don't map 1:1 to ESPN athlete IDs across all 8 sports.
