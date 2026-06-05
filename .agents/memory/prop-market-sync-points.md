---
name: Adding a new player-prop market (sync points)
description: Every place a new prop market key must be registered, or it silently half-works (fetched but mislabeled, or labeled but never fetched, or unlockable in chat).
---

Adding one new player-prop market key (e.g. a combo like `player_points_rebounds`)
is NOT a one-file change. The key must be registered in ALL of these or it
silently half-works:

1. **api-server `props.ts` `MARKETS_BY_SPORT.<sport>`** — the fetch list sent to
   The Odds API. Without it the market is never requested. (Period variants live
   in `QH_MARKETS_BY_SPORT`.)
2. **client `ParlayBuilder.tsx` label maps — there are SEVERAL duplicated copies**
   (one verbose multi-line map plus a few compact `{key:"Label"}` maps; grep the
   key of an existing market to find them all). Miss one and the prop shows its
   raw market key in some surfaces.
3. **client `STAT_KEY_BY_MARKET`** — maps market→single ESPN stat for analytics.
   Combos have no single stat, so set them to `null` (same as PRA); never guess.
4. **client `COUNTABLE_MARKET` regex** (in `friendlyPickLabel`) — controls the
   "Over 19.5 X" → "20+ X" display normalization. Easy to forget; combos need it
   to render like every other countable stat.
5. **api-server `chat.ts` `MARKET_KEYWORDS`** — the lock regexes. ORDER MATTERS
   (first match wins): multi-stat combos MUST precede the single-stat entries, or
   "pts+reb parlay" locks to plain points. PRA before the two-way combos.
6. **api-server `chat.ts` directional-consistency wording** — any points-INCLUSIVE
   combo (PTS+REB, PTS+AST, PRA) counts as a scoring leg for the Total-OVER /
   points-UNDER anti-correlation gate; REB+AST has no points component and is
   exempt like bare rebounds/assists.
7. **client `ParlayBuilder.tsx` `PROP_MARKET_KEYWORDS`** (~line 7414, SEPARATE from
   the chat.ts MARKET_KEYWORDS) — drives requested-market playerHistory
   prioritization / prop ordering. Easy to miss (architect caught it): omit it and
   "best sacks props" still locks server-side but the client never floats those
   props, so they fall back to "MARKET PRICE" with no real projection. ORDER MATTERS
   here too — stolen-bases entry must precede the generic NBA "steals" entry.
8. **mobile** `lib/api.ts` `PROP_MARKET_LABELS` + `PlayerPropsSheet.tsx`
   `MARKET_SINGLE` (column abbrevs) — the Expo app has its own label/abbrev maps.

**Markets added (verified real, June 2026):** MLB `batter_stolen_bases` (live on
~70% of MLB games, 28-44 outcomes) and NFL `player_sacks` (valid key; 0 outcomes
in offseason but populates in-season — safe because an empty real market does NOT
422). NBA `player_steals`/`player_blocks` already existed. Skipped `_alternate`
and `_q1/_h1` variants for both (no ladder/period lines → would all-or-nothing 422).
These are single-stat markets with no clean ESPN season-stat split, so
`STAT_KEY_BY_MARKET` = `null` (analytics skipped, never fabricated).

**Why:** the same prop key is referenced in ~6 disconnected places across two
artifacts; a partial add looks fine in one surface and broken in another.

**How to apply:** before adding, live-probe the Odds API per-event to confirm the
key returns real outcomes (combos verified: `player_points_rebounds`,
`player_points_assists`, `player_rebounds_assists`; `double/triple_double` are
yes/no shape — skipped; `field_goals/frees_made` return 0 outcomes). The Odds API
rejects the ENTIRE batch on one invalid key (422), so only add verified keys.
After editing: rebuild client + RESTART api-server (no watcher).

## Generic "combos" intent (vs. specific combo locks)
The combo O/U markets (player_points_rebounds_assists / _rebounds / _assists, player_rebounds_assists) were ALREADY fully wired — props.ts fetches them for nba/wnba, mobile PROP_LABELS labels them and they flow into realProps + propPool, and chat.ts MARKET_KEYWORDS had SPECIFIC combo locks ("pra", "pts+reb", ...). The miss: a bare "combos" ask (the sportsbook "Combos" tab) had NO keyword, so it fell through to a normal parlay.
Fix = one MARKET_KEYWORDS entry `/\bcombos?\b/i → [all 4 combo markets]`, placed AFTER the specific combo entries (so "pra combo" still locks PRA only) and BEFORE single-stat entries (so "combos" can't fall through to points). A multi-market lock array works unchanged through the lock filter + server fresh-fetch fallback + addendum (they already flatMap/join the markets[]).
**Why:** intent routing is the easy thing to forget when the data pipeline is already complete — the lock keyword is the last mile.
Double-Double / Triple-Double from that tab are yes/no (not O/U) markets, not fetched anywhere — out of scope here.
