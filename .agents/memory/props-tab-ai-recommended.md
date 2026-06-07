---
name: Mobile Player Props "AI RECOMMENDED" list
description: How the mobile Props-tab recommended list is sourced and why sides are chosen the way they are.
---

# Mobile Player Props "★ AI RECOMMENDED" list

The Props-tab recommended list is built from the **real props feed only**
(`propsQ.data` for the selected sport), NOT from the AI Coach's chat parlay
(`useBetSlip().aiPicks`). The user explicitly wanted a varied set independent of
chat ("put random ai picks not the ones from chat").

**Rules baked in (keep them):**
- Real player / real posted line / real price only. NO fabricated `edge` note on
  these cards (leaving `ParsedPick.edge` undefined hides the "AI Edge" pill), so
  the app never invents reasoning it doesn't have.
- Side is chosen by `recommendSide()`: when both sides are priced, take the
  **higher American number** (shorter-juice / value side) — a transparent rule,
  never a fabricated lean.
- **Yes/no markets (line null, e.g. anytime goalscorer / anytime TD)**: only the
  Over/"Yes" side is meaningful and the canonical pick string drops the side
  token (`${player} ${label}`). So force the Yes side and require `overPrice`,
  or the card shows odds for a side its label doesn't name.
- Pick-string + shape mirror `matchProp` in PickCard.tsx exactly
  (`${player} ${side} ${line} ${label}`, `market` = `propMarketLabel`,
  `isProp:true`) so slip add/dedupe behaves the same as Coach picks.
- Variety via Fisher–Yates shuffle inside the `useMemo` (deps `[propsQ.data,
  sport]`) — re-rolls on data reload / pull-to-refresh; `Math.random` in a pure
  memo is fine. Deduped one-per-player, capped 6, hidden while searching.

**Why:** never-fabricate is a DATA rule (odds/lines/stats), but a recommended
SIDE with no analysis would still imply a lean — so we ground the side in the
real price spread and omit any reasoning text.

## Ungraded fallback must NOT promote longshots (honesty)
The rail leads with A-tier graded picks + confident upsets. When NONE qualify it
falls back to ungraded `gradeCandidates`. That fallback originally sorted by the
LONGEST plus-money price ("market prices it as the better value") — which is
backwards: a long plus-money price means the market thinks the outcome is
UNLIKELY, not good value. Combined with `recommendSide` always taking the higher
American side (the Over), this surfaced rare-event longshots like "Over 0.5
Stolen Bases (+1350)" as top recommendations — and a player with NO game-log feed
(e.g. Mauricio Dubon) can never be graded, so he ALWAYS lands in this fallback.
Net effect: the players we know least about were recommended most strongly.
**Fix:** in the fallback, drop longshots (`pick.odds <= FALLBACK_MAX_ODDS`, +160)
and sort SHORTEST price first (most market-likely), no badge. If nothing
qualifies the rail is simply empty — honest beats padded with longshots. The
graded path is untouched, so a legit plus-money prop still surfaces WHEN a real
hit-rate backs it. Mobile-only (`app/(tabs)/props.tsx`); web has no such rail.
