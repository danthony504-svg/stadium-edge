---
name: "+ alt" / "- alt" sign lock (mobile Coach)
description: Forcing every parlay leg onto plus-money or minus-money rungs when the user asks for "+ alt" vs "- alt".
---

# "+ alt" / "- alt" odds-sign lock

A "+ alt" (or "plus alt") ask must put EVERY leg on plus-money rungs; "- alt" (or
"minus alt") must put every leg on minus-money rungs. A bare "N leg alt" keeps the
existing cushion default. Never fabricate a wrong-sign rung — drop instead.

**Why:** users treat "+ alt" as the aggressive upside ticket and "- alt" as the
safe deep-juice ticket; a mixed-sign slip (what bare alt produced) defeats the ask.

**How to apply — three layers, all mobile, all gated on `!oddsThreshold`** (a
threshold already implies the sign and takes precedence):

1. **Game-level alts** are the real gap: mobile emits ONE rung per side
   (`bestRungPerSide`, closest-to-even), so the model can't choose the sign. Thread
   `AltSign` through `buildChatContext → buildRealOdds → bestRungPerSide`; skip rungs
   on the wrong sign. A side with no matching-sign rung is simply omitted.
2. **Props** are best-effort: map `altSign` → `AltRungBias` (`plus`→`value`,
   `minus`→`cushion`); the matchProp swap maximizes right-sign retention but can keep
   a wrong-sign rung when the player's ladder has none.
3. **Hard guarantee:** a post-parse filter on resolved `picks` drops ANY leg (prop
   or game) left on the wrong sign — this is the only thing that makes the "EVERY
   leg" promise true. Surface a transparency note when it drops legs / leaves zero.

**Detection gotcha (the real one):** users type the sign at the FRONT of the
message — "- 9 leg alt" / "+9 leg alt" — NOT next to "alt". So a sign-adjacent-only
regex misses it and the slip silently keeps mixed signs. Detect a LEADING sign
(`/^\s*-(?=\s|\d)/`, `/^\s*\+(?=\s|\d)/`) OR a sign next to "alt" OR the words
plus/minus, all gated on `altMentioned`. The leading "-" needs a space/digit after
it and the alt-adjacent "-" must be start/space-anchored, so a compound hyphen like
`9-leg alt` never reads as minus (and `- 9 leg parlay` with no "alt" → no sign).
