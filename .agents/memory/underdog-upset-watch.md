---
name: Underdog Upset Watch
description: How "Upset Watch" surfaces games where the app's own mlLean favors the BETTING underdog, on web + mobile + chat prompt — and the never-fabricate rules around it.
---

# Underdog Upset Watch

Surfaces games where the app's OWN deterministic analytics lean (`mlLean`) is on the
team the market is FADING — i.e. the analytics-favored winner is also the betting
underdog. Lives as a dedicated card on web + mobile AND as a proactive AI-coach
callout. Reuses the existing matchup-history feed; NO new data source.

## Upset definition (must be identical on all 3 surfaces)
A game is an upset spot ONLY when ALL hold:
1. `mlLean` exists with `edge >= 1` (a real lean from L10 margin + season win% + venue split + streak + H2H).
2. `mlLean.side`'s real American ML price is numerically GREATER (longer) than its opponent's — the lean is ON the dog, not the favorite.
3. that dog price `>= +100` (genuine plus-money dog).
Then attach `mlLean.upset = { dogOdds }` where `dogOdds` is the REAL American price of `mlLean.side`. Sort the card by `mlLean.edge` desc.

**Why:** the highest-value signal the model has is "our analytics like the side the
market is pricing as the dog." Anything weaker (favorite, missing price) is NOT an upset.

## Never-fabricate guardrails (the whole point)
- Emit an upset ONLY when the real ML price for `mlLean.side` is found in the odds pool AND it is the longer, plus-money side. If the price is missing/unmatched, skip the game silently — never guess a dog price.
- Card hidden entirely when there are zero real upsets (no empty-state filler, no invented %).
- Prompt rule: if NO game has `mlLean.upset`, the coach says there are no model-backed dogs right now — it must NOT manufacture one, label a favorite an "upset", or state a price that isn't the real `dogOdds`.
- `mlLean.side` (the winner) is still fixed by the MONEYLINE CONSISTENCY rule. `upset` is an ADDITIVE flag only — it never flips which side the model is on.

## One source of truth for the lean
`computeMlLean`, `buildMlPriceByLabel`, `detectUpset` are extracted to MODULE scope so
the builder, the Upset Watch card, AND the chat-context enrichment all compute the lean
the same way. Web: module scope in `ParlayBuilder.tsx` (~714). Mobile: module helpers in
`lib/api.ts` (computeMlLean ported verbatim).

**Web→mobile price-join gotcha:** web `RealOddsEntry` is `markets[]`; mobile is FLAT
(one row per pick). Mobile `buildMlPriceByLabel` must filter `market === "Moneyline"`
and parse the `"<nick> ML"` pick form to recover the two prices per game-label — it can't
mirror the web `markets[]` walk.

## Wiring map
- Web: `upsetSpots` state + standalone effect (deps `[homeUpcomingGames, realOddsBySport]`) fetches `/api/sports/matchup-history` for games with stashed `homeTeamId/awayTeamId` (cap 14), computes lean+`detectUpset`, sorts by edge. Card in home view before UPCOMING. T001 enrich block also attaches `mlLean.upset` to the `matchupHistory` sent in the chat-context POST.
- Backend: `chat.ts` SYSTEM_PROMPT — `mlLean` doc mentions `upset?={dogOdds}`; dedicated "UPSET ALERT" directive after MONEYLINE CONSISTENCY. api-server has NO watcher → RESTART after edits.
- Mobile: `buildMatchupHistoryAndUpsets` wired into `buildChatContext` (history targets = pickable games with teamIds, cap 12/sport); `matchupHistory` conditionally added to context, `upsetSpots` returned. `fetchUpsetSpots(sports, signal)` is a standalone helper the coach screen uses to render an intro-only Upset Watch card (hidden once the user sends a message; tap a spot → asks the coach about it).
