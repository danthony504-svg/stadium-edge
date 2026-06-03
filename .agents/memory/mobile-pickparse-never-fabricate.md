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

`coach.tsx` calls `parsePicks(full, context.realOdds)`. `buildChatContext()`
(lib/api.ts) builds `realOdds` mains-only via `buildRealOdds` and gates by
`isPickable` (now-4h < t < now+48h).
