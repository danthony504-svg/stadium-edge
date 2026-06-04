---
name: Bare-signed odds threshold direction
description: How "15 leg -300" (a signed price with no comparator word) is interpreted as a per-leg odds bound in the coach parlay builder.
---

# Bare signed odds threshold ("15 leg -300")

`parseOddsThreshold` (duplicated & kept in sync across THREE files: stadium-mobile
`lib/format.ts`, stadium-edge `ParlayBuilder.tsx`, api-server `routes/chat.ts`)
originally required an explicit comparator word ("or more"/"or less"/"at least"…)
before it would register a price bound. A bare signed price like "15 leg -300"
parsed to `null`, so NO bound was applied and the AI returned a random odds mix
(heavy chalk like -424 AND longshots like +850) — the user's stated number was
silently ignored.

## Rule
A bare **signed** price (sign token present, no comparator word, no trailing "+")
now infers direction FROM THE SIGN:
- negative ("-300") → `atMost` (odds <= signed) = FAVORITES at that line or
  heavier; drops the longshots.
- positive ("+300") → `atLeast` (odds >= signed) = DOGS at that line or longer.

An **unsigned** bare number (no sign token) still returns `null` — this is what
keeps leg counts ("10 leg"), yardage ("300+ passing yards"), and incidental
numbers from falsely tripping the filter. The guard is the existing `signTok`
check; do not relax it to unsigned numbers.

**Why:** user asked "15 leg -300", got a ticket containing +850/+165/+118 dogs
and -375/-424 chalk. `atLeast -300` would still KEEP the +850 dogs (>= -300); only
`atMost` removes them and yields a coherent heavy-favorite ticket, which is the
intent behind a big safe parlay. The sign-driven default ("the sign says which
side of the board you want") is the only one-sided reading that makes both the
negative and positive cases coherent.

**How to apply:** if you ever change the comparator regexes or add a new bare
form, edit ALL THREE copies together and re-run the same case table
(`"15 leg -300"`→atMost-300, `"15 leg +300"`→atLeast+300, `"10 leg"`→null,
`"300+ passing yards"`→null, `"-300 or longer"`→atLeast-300). Trade-off accepted:
incidental signed prices in non-build chat ("line moved to -120") now parse to a
threshold, but it only matters when a parlay is actually built, so it's harmless.
The user-facing threshold note ("every leg priced -300 or shorter") surfaces the
interpretation so the user can correct it with an explicit comparator.
