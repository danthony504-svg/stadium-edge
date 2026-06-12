---
name: Web slate cache + browse load-more
description: stadium-edge web port of the mobile instant-load/load-more pattern, and where the web's "props page" actually lives
---

# Web instant-load + browse load-more (stadium-edge)

The web app has **no dedicated multi-game props page** like the mobile Props tab.
On web, props are fetched per-game only when a game-detail opens; the multi-game
browse surfaces are the **All Sports league detail** games list and the
**View-all Upcoming** list. The global `fetchAll` effect loads
`realGamesBySport` (all sports) + `realOddsBySport` (selected sports) and powers
Home / All Sports / Upcoming / search.

## Instant-load
`src/lib/slateCache.ts` persists `{games, odds, upcoming}` to localStorage
(`stadium_edge_slate_v1`), 30-min freshness cap + per-sport size bounds, save
never throws. ParlayBuilder hydrates `realGamesBySport`/`realOddsBySport`/
`homeUpcomingGames` from it as **initial useState** so browse surfaces paint
instantly while `fetchAll` revalidates. Snapshot is saved inside the odds
`.then` (so `upcoming` is built) and only when `all.length > 0`.

**Why:** cold load showed sim/empty until fetch finished.
**Gotcha:** live in-progress games are intentionally NOT restored (stale scores
mislead) — `homeLiveGames` stays `[]` until the first fetch.

## Load-more
`BROWSE_INITIAL_GAMES=8`/`BROWSE_GAMES_STEP=8`. Per-list visible window state +
a total-count ref set during render; scroll-near-bottom (within 600px) and a
"Load more" button both grow the window, stopping once the ref total is reached.
Applied to the All Sports games list and the View-all Upcoming list (both
previously rendered the whole slate at once).

## Reuses server warming
No server change — `fetchAll` already hits `/api/sports/games` and
`/api/sports/odds`, the endpoints the prebuild/cron prewarm warms.
