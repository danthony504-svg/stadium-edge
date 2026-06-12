---
name: Home Featured Players rail — progressive load
description: Why the mobile Home featured-props rail uses per-game useQueries instead of one allSettled query
---

The mobile Home "Featured Players" rail must render PROGRESSIVELY — one React Query
per featured game (`useQueries` over the first ~4 games), merging whatever has
resolved so far (dedupe by player, cap 8). Spinner shows only until the FIRST game
resolves; once any player appears the section stays populated while slower games
fill in behind it.

**Why:** A single `useQuery` that fanned out `getProps` over all 4 games via
`Promise.allSettled` waited for the SLOWEST game. On a cold cache (prebuild cron not
yet warmed) that left the rail stuck on "Loading featured props…" for many seconds —
the user reported it as broken on WNBA. Endpoints are actually fast when warm
(WNBA odds ~17ms, props ~7ms / 178 props); the stall was purely the wait-for-all
pattern × cold cache.

**How to apply:**
- Keep the per-game queries gated on `featuredEnabled && gamesQ.isSuccess` so ESPN
  team ids/abbrs/crests attach (headshots optional → avatar falls back to initials).
- HONESTY filter `if (p.alt || p.overPrice == null) continue` must stay.
- Manual `refetch()` fires even on disabled RQ v5 queries, so guard the
  pull-to-refresh fan-out with `if (featuredEnabled)` or it fires up to 4 wasted
  props fetches on non-props sports.
- Sport ids for the odds/props endpoints are app ids (`wnba`, `mlb`…), NOT Odds API
  keys (`basketball_wnba` → "Unsupported sport"). curl dev at `http://localhost:8080`.
