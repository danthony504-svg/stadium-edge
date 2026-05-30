---
name: Big-parlay prop-fetch cap must scale with requested leg count
description: Why a "15-leg" ask returned only ~10 legs with zero props, and the cap-scaling fix in the chat JIT prop-fetch block.
---

# Big-parlay prop-fetch cap scaling

"I asked for a 15-leg parlay and got ~10 legs with ZERO player props" is NOT a
prompt problem and NOT a no-data problem — it's the client's just-in-time
prop-fetch block capping how many games' props it fetches, independent of the
requested leg count.

**Mechanism (ParlayBuilder.tsx chat-send prop-fetch block, the `if (wantsProps || wantsParlay)` gate):**
- For generic parlay intent (no prop-market keyword, no named game) the caps were
  static: `perSportCap = 3`, `totalCap = 6`. So props were fetched for at most 6
  games no matter how many legs were requested.
- Player props are the prompt's PRIMARY lever to reach high leg counts (distinct
  players = distinct non-correlated legs; one-leg-per-game/market-family ban means
  game-level legs alone top out at ~2 independent sides per game).
- Net: few games × ~2 game-level legs + props for only 6 games ⇒ ~10-leg
  structural ceiling, and on a thin slate the props often didn't even surface.

**Fix:** parse the requested leg count N from the message
(`text.match(/(\d+)\s*-?\s*(?:leg|legg|pick|game)/i)`), and when `N >= 8`
(bigParlay) scale the caps: `perSportCap = min(N,12)`, `totalCap = min(N+4,24)`.
Only games that truly exist in the 48h window get fetched; bounded concurrency
(5 workers) + the 5-min server prop cache + the 429 retry keep it cheap.

**It took TWO levers, not one (this is the key correction):** the cap fix was
necessary but NOT sufficient. After it, a "15-leg" send verifiably delivers a
RICH pool to the model (durable server diag: realProps=400, ~41 distinct players,
realOdds=120, ~18 games) — yet the model still under-built to ~4 legs and even
falsely told the user "realProps is empty." So the prompt DID also need work.

**Real-world limiter = distinct PROP games, not prop count.** At a typical hour
only ~3 games have props posted (e.g. one NBA game alone returns ~691 props,
capped to 200/game in assembly), while many games return 0 props or a 502. So the
400-cap fills from ~3 games / ~41 players — tons of players but heavily same-game,
hence correlated. To reach a large N HONESTLY the model must combine ONE leg per
distinct game across the ~18 game-level games in realOdds (props where available,
else ML/spread/total) and only THEN add extra distinct-player props from the
prop-rich games. The model wouldn't do this on its own.

**Prompt fix (chat.ts SYSTEM_PROMPT, the "N-leg parlay" REQUEST TYPE line):**
added explicit "HOW TO SCALE TO N" guidance — (1) one leg per distinct game first,
(2) then extra distinct-player props (different player AND stat family) from
prop-rich games, noting same-game correlation, (3) COUNT distinct games/players
before shortening, (4) HARD guard: never claim/imply realProps is empty when it
has entries (it's the authoritative live pool). No HARD BAN (correlated/duplicate
market×period×game, anti-fabrication, shorten-if-truly-thin) was loosened.

**Diagnosis tip that cracked it:** ephemeral pino logs were unreadable (api-server
has no watcher and the test harness keeps restarting it, rotating logs). Use a
DURABLE file append (e.g. /tmp/chat_diag.log) of realProps count + distinctPropGames
+ distinctPropPlayers + propsPerGame to see exactly what reached the model. REMOVE
it (and any client console diag) before commit. You can also fully replicate the
client's toFetch/assembly in the code_execution sandbox against localhost:8080
(odds + props endpoints) to compute the pool without a browser.

**Gotchas / non-obvious:**
- `isWithin24h` in this block is MISNAMED — it actually enforces a 48h window
  (`CHAT_WINDOW_MS = 48h`). Don't "fix" it to 48h thinking it's 24h.
- Props ARE fetchable for fallback-odds games (ESPN/Bovada ids) via the
  home/away → real Odds API id resolution; pass `home`/`away` in the props query.
- `wantsProps` (explicit prop keyword) already uncapped to 5/12, and
  `wantsWideProps` (HR/K/anytime-TD) to 999 — this fix only raises the
  parlay-ONLY (generic) path that previously stayed at 3/6.

## Third lever: breadth-vs-depth, and game-breadth must be CAPPED or the model skips props

There turned out to be a THIRD lever in the realOdds assembly (the game-level menu),
discovered after the fetch-cap + prompt fixes. Two parts, in tension:

1. **Breadth over depth (fixes the leg count / false "only ~10 legs" scarcity).**
   realOdds is flat-capped at 120 ENTRIES. Each game contributing `mainPicks(≤8) +
   altSpread(≤8) + altTotal(≤6)` ≈ 18 entries meant only ~6-7 DISTINCT games fit →
   the model honestly capped tickets at ~10 independent legs. Fix: a `breadthMode`
   (`bigParlay && !named && !period`) that DROPS the per-game alt ladders, so the
   120-entry budget spans ~17-30 distinct games. Verified: distinctOddsGames 6-7 → 17,
   legs 4 → 13-15. This is what actually killed the false-scarcity claim.

2. **But abundant breadth then made the model SKIP the mandated props.** With 17
   game-level games it filled a 15-leg ask with 15 spreads, 0 props — even though
   realProps held 44 distinct players AND playerHistory populated (40). Prompt-only
   "props first" + self-check did NOT move it (model treats props as optional when
   game-level alone suffices). **Structural fix that worked:** cap DISTINCT
   game-level games in breadthMode to `requestedLegs - reservedPropSlots` (`continue`
   the per-game loop once a `breadthGameCount` counter hits the cap). Now game-level
   can't fill N alone → the model must draw the back of the ticket from the prop pool.
   Verified: 15-leg ask → distinctOddsGames 11, output 15 picks / 4 props.

**Why (the durable principle):** leg-count and prop-share are SEPARATE failure modes
with OPPOSITE data needs. Widening the game-level menu fixes count but starves props;
the prop share only appears when game-level supply is deliberately throttled below N.

**CRITICAL under-fill guard (or you trade one bug for another):** the game cap must
be ADAPTIVE to real prop availability. A static `N-4` cap under-delivers N on a
prop-thin slate (game-level throttled below N, but not enough props exist to backfill).
Pre-count WINDOW-VALID distinct prop players (same `isWithin24h` + `gamePickable`
filter the realProps build uses — build `eventToStart`/`eventToGame`/`mergedPropsByEvent`
up-front so the cap can see them) and set `reservedPropSlots = min(4, availablePlayers)`,
`breadthGameCap = max(8, N - reservedPropSlots)`. With 0 props available the cap relaxes
to N so game-level fills the whole ticket. Named/period/SGP tickets stay exempt
(they intentionally lean on one game's depth — don't cap them).

**14-vs-15 is fine:** model output is nondeterministic (saw 10/13/14/15 across runs);
the goal is "no false ~10 ceiling + a real prop share," not an exact integer.
