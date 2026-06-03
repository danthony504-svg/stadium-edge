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

**Notes:**
- `propPool` (render/resolution pool used by parsePicks) is uncapped, so only AI *visibility* was the
  constraint — fixing `realProps` selection was sufficient; resolution never needed widening.
- Optional (skipped, low value in-season): bucket by `sport+game` instead of `game` to avoid rare
  cross-sport "Away @ Home" name collisions when multiple sports are selected.
