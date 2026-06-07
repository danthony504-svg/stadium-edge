---
name: Chat PickCard rich look (grid vs pills)
description: Why the mobile AI Coach chat pick card has a richer look than slip/game-detail, and how the split is enforced
---

The mobile AI Coach **chat** pick card (`components/PickCard.tsx`) uses a richer
layout: market pill+icon, large odds, colored Away@Home matchup line, divider,
card-style Safe/Best/Value rung boxes, and a bordered Model/Implied/Edge/
Confidence/**Safety** stat GRID.

**Where it's used (current):** the rich `PickCard` is the AI-RECOMMENDED card on
Coach (chat), the **Player Props tab**, AND the **Bet Slip** (290px-wide cells in
a horizontal ScrollView). Only **game-detail** (`app/game/[id].tsx`) still renders
the compact `AiPickCard` (pill chips) — left as-is unless asked.

**Why:** user compared Slip (compact) vs Props (rich) and said "I like the new
one — the old one you can't see all the information," so the Slip was switched to
`PickCard`. (Earlier in the project they'd wanted rich "only in chat"; that
preference was superseded.)

**How to apply:**
- `EdgeReadout` is SHARED by chat/props/slip `PickCard` AND `AiPickCard`
  (game-detail). It takes a `grid?: boolean`: `PickCard` passes `grid` → bordered
  stat cells; `AiPickCard` passes nothing → original pill chips.
- To unify a surface, swap `<AiPickCard pick={p}/>` for a `<View style={{width:290}}><PickCard pick={p}/></View>` in a horizontal ScrollView (see props.tsx / slip.tsx).
- "Safety" descriptor = relabeled `deriveVariance` (Low→Safe, Medium→Balanced,
  High→Aggressive); same signal, friendlier word. Not fabricated.
- Everything on the card is REAL/derived from `ParsedPick` (real `altOptions`
  rungs, `parseEdgeStats` numbers, `startsAt`) or hidden — never invented.
- Market pill icon (`marketIcon`) and Away/Home colors are DECORATIVE only.
