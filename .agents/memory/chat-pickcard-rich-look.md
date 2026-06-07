---
name: Chat PickCard rich look (grid vs pills)
description: Why the mobile AI Coach chat pick card has a richer look than slip/game-detail, and how the split is enforced
---

The mobile AI Coach **chat** pick card (`components/PickCard.tsx`) uses a richer
layout: market pill+icon, large odds, colored Away@Home matchup line, divider,
card-style Safe/Best/Value rung boxes, and a bordered Model/Implied/Edge/
Confidence/**Safety** stat GRID.

**Why:** user wanted the rich card look "only in chat" — the Player Props tab
stays on its old player-picture look (an earlier rich-props redesign was built
then fully reverted). Slip + game-detail must keep their compact look too.

**How to apply:**
- `EdgeReadout` is SHARED by chat `PickCard` AND `AiPickCard` (slip tab +
  game-detail). It takes a `grid?: boolean`: chat passes `grid` → bordered stat
  cells; slip/game pass nothing → original pill chips. Don't make the grid the
  default or you leak the new look onto non-chat surfaces.
- "Safety" descriptor = relabeled `deriveVariance` (Low→Safe, Medium→Balanced,
  High→Aggressive); same signal, friendlier word. Not fabricated.
- Everything on the card is REAL/derived from `ParsedPick` (real `altOptions`
  rungs, `parseEdgeStats` numbers, `startsAt`) or hidden — never invented.
- Market pill icon (`marketIcon`) and Away/Home colors are DECORATIVE only.
