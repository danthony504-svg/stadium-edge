---
name: Mobile chat prop-pool breadth
description: Why the mobile AI Coach saw player props from only a few games, and the breadth-first fix
---

# Mobile AI Coach prop-pool breadth

The Coach reported "props concentrated mostly in [2-3 games]" / "no playerHistory block"
and under-built big or all-games parlays — looking like it only used team/game markets.

**Root cause:** `buildChatContext` (stadium-mobile `lib/api.ts`) fetched per-game props with
`Promise.all` (pushes in completion order) then did `realProps.slice(0, CAP)`. MLB games each
post 100+ prop rows, so the first 2-3 games that resolved filled the cap and starved every other
game. The AI literally never *saw* most available player props — it wasn't preferring team props.

**Fix (the rule):** the AI-visible prop list must be selected **breadth-first across games**, not
in arrival order. `balancePropsByGame(props, cap)` round-robins one prop per game per pass so every
fetched game is represented before any game contributes a second row. Also bumped games-fetched and
the row cap so the breadth selection has room.

**Why:** an order-blind slice over parallel fetches is non-deterministic AND game-biased; raising the
cap alone does not fix it (a single deep game can still dominate). Round-robin guarantees coverage.

**How to apply:** any time a capped list is built from `Promise.all` of per-entity fetches and the
consumer needs *breadth* (all games/players represented), select round-robin by the grouping key — do
not `.slice()` the arrival-order array. Mirrors the web "big-parlay-prop-fetch-cap" lesson.

**Second dimension — breadth ACROSS markets, not just games (combo props):** round-robin by game alone
keeps each game's props in raw FETCH order, and markets are fetched single-stats-first (points,
rebounds, assists, …) with COMBO markets (Pts+Reb+Ast / Pts+Reb / Pts+Ast / Reb+Ast) and blocks/steals
LAST. A single prop-rich game then exhausts the cap on its single-stat mains and the combos get sliced
off the tail — so the AI never *saw* combos in `realProps` and "never picked them," even though they're
real and `propPool` (resolution) had them. Fix is a **two-level interleave**: rotate markets WITHIN each
game (`interleaveByMarket` — round-robin the game's props by `market`), THEN round-robin ACROSS games.
The within-game rotation surfaces combos; the across-game rotation preserves the per-game breadth above.
A one-stage `game|market` key fixes combos but REGRESSES game breadth (a deep game's many market buckets
crowd out other games) — keep the two levels separate. Pairs with a chat.ts prompt nudge listing the
combo markets as first-class stat families to mix in (points-inclusive combo counts as a scoring leg for
anti-correlation; combo+single on same player is still one athlete).

**Third dimension — FOCAL priority, not just even breadth (single-game N-leg under-fill):** even
breadth is WRONG when the user named ONE sport/game. `realOdds` is focal-ranked (`rankedOdds`) but
`realProps` was NOT — it round-robined evenly across ALL games/sports. On a multi-sport night (e.g.
MLB-heavy June) a lone focal NBA game posting 19 players / 686 rows got diluted to a ~1/N share, so a
"10 leg NBA" ask only surfaced ~3-8 NBA players and the model honestly stalled at 8 — looking like a
thin slate when the one game had ample depth. **Fix:** `balancePropsByGame(props, cap, focalText?)` —
when `focalText` names a sport/game (reuse `focalSportsFromText` / `gameMatchesFocalText`), fill the cap
from the FOCAL slate first (still breadth- + combo-balanced via the extracted `balancePropsCore`), then
backfill leftover cap with the rest. Guard `focal.length < props.length` so focal==all falls through.
**Why:** even round-robin optimizes cross-game coverage, which is the OPPOSITE of what a single-focus ask
needs; the cap is the scarce resource and the named slate must win it. **How to apply:** any capped,
breadth-balanced context list that ALSO serves single-target asks needs a focal-first pass before the
even-breadth pass — mirrors web `focal-prop-float`.

**Notes:**
- `propPool` (render/resolution pool used by parsePicks) is uncapped, so only AI *visibility* was the
  constraint — fixing `realProps` selection was sufficient; resolution never needed widening.
- Optional (skipped, low value in-season): bucket by `sport+game` instead of `game` to avoid rare
  cross-sport "Away @ Home" name collisions when multiple sports are selected.
