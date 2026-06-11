---
name: Arbitrage detector honesty gates
description: Why the mobile cross-book arb finder rejects borderline/invalid "arbs" beyond the raw <100% implied-prob test.
---

# Arbitrage detector honesty gates (mobile)

The mobile Arbitrage section surfaces a guaranteed-profit bet only when 2/3
mutually-exclusive sides, each at its BEST real book, have combined implied prob
< 100%. Beyond that core math, three gates exist because the naive test leaks
data artifacts that would dishonestly read as "risk-free money."

**Rule 1 — enforce the profit band against RAW, not rounded, profit.**
`computeArb` returns the *unrounded* profit %. Callers check `MIN_ARB_PCT`(0.1)/
`MAX_ARB_PCT`(30) against the raw value, then round only for display (via
`acceptArb`).
**Why:** rounding profit to 1dp before the cap let a true 0.05% round up to 0.1
and pass, and a true 30.04% round down to 30.0 and pass — exactly the stale-line
boundary artifacts the band is meant to drop.

**Rule 2 — require DISTINCT books per opposite leg.**
`acceptArb` rejects when the leg books aren't all distinct (case/space-normalized).
**Why:** a single book pricing a guaranteed loss against itself is a stale-line /
palpable-error artifact, not a real bet, and the product promise is literally
"bet each side at a different book." Props enforce `overBook !== underBook`; game
lines enforce distinct best-books across the group.

**Rule 3 — require semantic opposite sides, not just structural grouping.**
`isOppositeSides` (called inside `mutexGroups`) guards against upstream
mislabeling: totals need exactly one Over + one Under at the same point; spreads
need opposite-sign points (a.point*b.point < 0); h2h needs ≥2 distinct outcome
names. Grouping by point/|point| + length===2 alone admitted two-Over or
same-sign-spread "pairs."

**How to apply:** any change to `findGameLineArbs`/`findPropArbs` must keep all
three gates; never widen to surface more opportunities by relaxing them. Tests in
`lib/arbitrage.test.ts` cover the boundary caps, same-book rejection, and
malformed groups — keep them green (`node --test 'lib/arbitrage.test.ts'`).
