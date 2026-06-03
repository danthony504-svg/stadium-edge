---
name: Mobile slip never-fabricate matcher
description: How the Expo AI Coach guarantees only real games/markets/prices reach the slip
---

# Mobile (stadium-mobile) never-fabricate pick parsing

`parsePicks(text, realOdds)` in `components/PickCard.tsx` is the single safety
gate between the chat model's free text and the betslip. It resolves every AI
`PICK:`/`ALT:` line back to a REAL entry in the `realOdds` pool that was sent as
context to the same model call, and emits the REAL entry's fields.

## The rule
Never render or add a pick the model invented. Resolve-or-drop, fail-closed.

## How to apply (the 4 gates — all must pass)
1. **Empty pool → `[]`.** No real odds context (feed outage) means zero
   add-to-slip cards. Never trust AI text alone.
2. **Game gate** `sameGame()` — ≥2 shared alphabetic team tokens (len>2).
3. **Market-family gate** `marketFamily()` — collapse wording to
   spread/total/moneyline so an AI "Spread" can NEVER resolve to a real
   Moneyline entry (caught in testing: numeric `+1.5` matched the wrong market).
4. **Selection gate** `selectionMatches(entryPick, aiSelection)`:
   - every NUMERIC token of the real line (the side/line, e.g. `-1.5`, `8.5`)
     must appear in the AI text exactly, AND
   - every NON-generic alphabetic token (team/side identity) of the real line
     must appear — generic words (`ml`, `moneyline`, `over`, `under`, `total`,
     `spread`, `line`, `runline`, `puckline`) are ignored so "Brewers ML" still
     matches "Milwaukee Brewers moneyline".

**Why both numeric AND team tokens:** a 50%-overlap fuzzy match leaked
"Brewers +1.5" → real "Giants +1.5" (same number, wrong team). Requiring the
team token closed it. Requiring the numeric token closed wrong-total leaks
("Over 9.5" vs real "Over 8.5").

Output fields (game/market/pick/odds/sport) are ALWAYS copied from the matched
real entry, never parsed from the AI line. `norm()` lowercases, converts unicode
minus `−–—`→`-`, strips to `[a-z0-9+\-. ]`.

Heavy abbreviations (e.g. "SF @ MIL") fail the game gate and drop — acceptable;
the chat prompt instructs the model to echo full game labels from context.

`coach.tsx` calls `parsePicks(full, context.realOdds, propPoolFromContext(context.realProps))`.
`buildChatContext()` (lib/api.ts) builds `realOdds` mains-only via `buildRealOdds`
and gates by `isPickable` (now-4h < t < now+48h).

## Player props (added later — mobile used to send NONE)
For a long time mobile sent NO `realProps`, so any prop the Coach "recommended"
was pure fabricated prose (the user's "o5.5 strikeouts" was AI text, never a real
line). Fix has two halves:
- **Feed:** `buildChatContext` now fetches props for the soonest ≤10 pickable
  games across `PROPS_SPORTS` (reusing the already-fetched `oddsAll`/`gamesAll`,
  mains-only, per-game fail-tolerant, capped ~240) and returns `realProps`
  (raw-key market shape the api-server prompt already consumes). api-server
  needed NO data change — it already documents/mandates `context.realProps`.
- **Resolution:** `propPoolFromContext(realProps)` expands each prop into
  side-per-row `PropPoolEntry[]` (client-only, NOT sent to API). `matchProp` in
  parsePicks is fail-closed: sameGame + player last-name token + EXACT posted
  line token + matching Over/Under side (`sideOf` tolerates both "Over 5.5" and
  legacy "o5.5"); yes/no markets (line null) skip line/side. Label is REBUILT
  full-word ("<Player> Over <line> <Market>") and odds come from the real entry —
  this is also what kills the "o5.5" shorthand on cards (#2).

## Prop-vs-game pool MUST be decided by player-name, NOT marketFamily-first
`marketFamily("Total Bases")` / `"Shots on Goal"` both collapse to `"total"`, so
a game-pool-FIRST order let a prop "Over 5.5 Total Bases" mis-resolve to a same-
numbered game total (real collision: NHL game total 5.5 vs a shots/SOG prop 5.5).
**Rule:** up front, a selection is a PROP iff some pooled prop for that game has
its player's last name in the selection → resolve ONLY against the prop pool
(drop if not real); else game-level. Safe because game totals/spreads/ML never
carry a player last-name token. Never reintroduce game-pool-first + prop-fallback.

`isProp:true` tags prop ParsedPicks. The latest Coach parlay's picks are pushed
to an in-memory (NOT persisted) `aiPicks` store on `BetSlipContext` via
`setAiPicks` (only when picks.length>0, so plain Q&A doesn't wipe it) and pinned
as "★ AI RECOMMENDED" PickCards atop the Player Props tab (filtered `isProp`) and
the Picks/slip tab (all aiPicks).

## Coach chat is CARDS-ONLY for pick replies; cards toggle add/remove
`assistantBubbleText(content, hasPicks)` returns `""` when a reply resolved into
pick cards → the whole assistant bubble is hidden (no lead-in prose, no PICK/
EDGE/ALT rows, no trailing combined-odds/risk/alternates block). All reasoning
reaches the user ONLY via each card's per-pick EDGE note (`pick.edge`), so never
drop the EDGE rendering. `showBubble` skips empty bubbles; fail-closed (0 picks)
still shows full text so nothing is silently hidden; streaming shows text then
collapses to cards at the end. **Why:** user wanted a clean card-only parlay view.
PickCard slip button is a TOGGLE (`onToggle`): add when absent, `removeLeg(id)`
when present (id = `${game}|${market}|${pick}`.toLowerCase() == BetSlipContext
legKey); label "Added — tap to remove". Not disabled after adding.

## EDGE note is a collapsible "AI Edge" pill, not inline text
PickCard renders `pick.edge` behind a tappable pill (zap icon + "AI Edge" +
chevron) that toggles a per-card `edgeOpen` useState via `LayoutAnimation`
(Android needs the `setLayoutAnimationEnabledExperimental` module-scope guard;
RN-web treats configureNext as a no-op so it's safe). Still wrapped in
`pick.edge ? … : null`. **Why:** user wanted compact cards with edge reasoning
on demand. Don't revert to always-inline edge text.

## Floating pop-up Bet Slip bar (SlipBar)
`components/SlipBar.tsx` rendered ONCE in (tabs)/_layout (with NavMenu) = a
bottom floating slip summary (leg count + combinedOdds + "$stake to win $X",
toWin = payout(stake,combinedOdds)-stake) that expands to a removable leg list +
"Open full slip". Returns null when legs empty. MUST hide on `/slip` (that page
IS the full slip) AND `/coach` (its chat composer owns the bottom — overlap
otherwise). LayoutAnimation needs its own Android guard (don't rely on PickCard
importing first).
