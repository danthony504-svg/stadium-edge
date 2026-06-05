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
