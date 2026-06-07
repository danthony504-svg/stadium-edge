---
name: PickCard grid tile width
description: Why the Confidence stat tile clips in fixed-width PickCard hosts and how to keep it from overflowing.
---
The shared `EdgeReadout` grid layout (mobile `components/PickCard.tsx`, always
on for `PickCard`) renders 3 stat tiles — AI Grade / Edge / Confidence — each
`flex:1` with `minWidth: 96`, gap 8. Three tiles therefore need
3×96 + 2×8 = 304 of inner width, plus the card's own horizontal padding
(12×2) ≈ **328px total**. Any host that puts a `PickCard` in a narrower fixed
box (the Bet Slip's horizontal "★ AI RECOMMENDED" carousel used `width: 290`)
pushes the third tile past the rounded card edge, clipping "CONFIDENCE" → it
reads "CONFIDEN" and the value gets cut.

**Rule:** when hosting `PickCard` in a fixed-width container, size it ≥330px so
the grid fits. The tile *label* also has `numberOfLines={1} adjustsFontSizeToFit
minimumFontScale={0.8} flexShrink:1` so it shrinks instead of clipping/wrapping
at any width — keep that as a backstop.
**Why:** user reported the Confidence tile "flowing over" on the slip screen.
