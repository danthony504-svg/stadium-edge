---
name: Single-game request is game-locked (no cross-game props)
description: When a request names ONE specific game, every leg (markets AND player props) must come from that game only — never widen to other games to hit the leg count.
---

# Rule
A request that names a single game ("best parlay for Blue Jays @ Orioles", or the game-card → leg-count flow) is GAME-LOCKED: every leg, including player props, must come from that one game. The model must filter realProps to the named matchup and IGNORE all other games' props. If the game can't supply the requested count of independent, non-correlated legs, return fewer and add an honest note — NEVER substitute legs from a different game.

**Why:** User was explicit — "if a specific game is asked for, only pull props for that game." A same-game/named-game ticket that quietly pulls another game's props is wrong by definition and erodes trust. This is distinct from a generic "N-leg parlay" / "props only" request, which MAY span games.

# How to apply (two surfaces, belt-and-braces)
- Prompt (`chat.ts` REQUEST TYPES, the "Best parlay for <game>" line): the GAME-LOCK clause. This is the authority.
- Client (`ParlayBuilder.tsx` confirmLegCountForGame): the auto-sent message for the game-card flow appends an explicit "only use markets/props from THIS game; if it can't supply N legs, return fewer and say why" so the model can't misread intent.
- The old rule capped this at "2-4 legs" and didn't mention props — that was the gap that let cross-game props in. Honor the requested N up to what the single game actually supports.

# The lock must also reach the PROP-FETCH stage, not just the prompt
The game-lock lived only in the prompt — but the client's prop pre-fetch
(`ParlayBuilder.tsx` `sendMessage`, the `wantsProps || wantsParlay` block) picked
games by a generic heuristic: soonest N per sport (`perSportCap`), then a global
`totalCap` (6 for a parlay). A NAMED game that isn't among its sport's soonest few,
OR that falls past `totalCap` once other in-season sports (MLB/NHL late-May) fill
the cap first, never had its props fetched. realProps for that game arrived EMPTY,
so the AI honestly-but-wrongly said "only 1 independent leg available — no props
posted" even though the book had 600+ props for it.
**Fix:** detect named games client-side (`gameNamedInText` — both teams' last-word
nicknames appear in the message text), always include them regardless of
`perSportCap`, and put them at the FRONT of `toFetch` so the global cap can never
drop them (`namedCandidates` first, others fill the remainder).
**Why:** game-lock that exists only at prompt time is undermined if the data the
prompt needs was never fetched. A scarcity claim is only honest if the pool was
actually loaded.
**How to apply:** any future per-message data pre-fetch that's gated by a
soonest-N / total cap must exempt explicitly-named games. Note this is distinct
from the genuinely-empty pool case (Odds API rate-limited / OFFLINE) below — verify
server-side props EXIST before assuming a fetch gap.

# Note
The odds/props pool goes fully empty when The Odds API is rate-limited (shows OFFLINE in the UI). During those windows a named game has no props at all, which is correct/honest, not a bug — don't "fix" emptiness by widening to other games.
