---
name: All-games ticket intent
description: Why "all games today" must be its own sizing intent, not an inherited N-leg request, in the chat parlay builder.
---

# All-games ticket intent

"all games (for) today" / "every game" / "one pick from each game" is its OWN sizing
intent: ONE pick per distinct pickable game. It is NOT an N-leg request.

**Why:** `requestedLegs` falls back to `inheritLegCount()` which scans prior user turns
and inherits the most recent explicit count. So a follow-up like "can you do all games
today?" right after a "15-leg parlay" ask inherited 15. That caused two failures:
1. It tripped the thin-slate period unlock (`thinBigParlay`) → period markets entered
   context → the model could pad to 15 with period legs.
2. The "15" in conversation history nudged the model to emit 15 PICK lines while its
   prose honestly said "one per game = 11". The slip badge counts PICK lines
   (`messagePicks.length`), so the badge ("15-LEG SLIP / Add all 15") contradicted the
   message prose. **Mismatch between prose count and slip badge = AI emitted N PICK
   lines but its preamble disagreed.**

**How to apply (3 coordinated levers — keep all in sync):**
- Client `allGamesIntent` regex (ParlayBuilder send path): matches all/every + games/
  matchups (with a negative lookahead so "all game totals/spreads" stay market-wide),
  plus "each game" and "one per game". Two client effects gate on it:
  - `thinBigParlay` adds `&& !allGamesIntent` (never unlock periods for all-games —
    one-per-game by definition).
  - The `breadthGameCap` block adds `&& !allGamesIntent` so the inherited-count breadth/
    prop-reserve cap (`max(8, requestedLegs - reservedPropSlots)`) never truncates the
    slate. WITHOUT this, an all-games ask with props available caps context at ~11 games
    and silently drops games on a larger slate. (Latent — only bites when props exist AND
    >~11 games; empty-props tests won't surface it.)
- Server prompt (chat.ts SYSTEM_PROMPT REQUEST TYPES): an "ALL-GAMES TICKET" type —
  exactly ONE pick per distinct game with posted odds; leg count = number of pickable
  games; IGNORE any inherited/earlier leg count; no padding (period/alt/second-leg);
  prose count MUST equal PICK-line count; exclude games without odds and say so;
  props-mandatory rule does NOT add extra legs (one-per-game is the hard cap).

**Note:** `requestedLegs` is intentionally left inherited (not resized to game count) —
it only governs how much DATA/prop breadth is fetched, which is harmless once the period
unlock and breadth cap are excluded and the prompt enforces one-per-game.

**Verify:** server can only be tested for the prompt rule (client logic is browser-only).
Harness: POST /api/chat with history=[15-leg ask, assistant] + "all games for today" +
a 12-game realOdds pool → expect exactly 12 PICK lines, 0 period legs, prose count = 12.
Regression: a genuine "15-leg only today's games" on a thin 6-game pool still returns 15
(period legs allowed). Client regex tested in isolation (Node) against match/no-match lists.
