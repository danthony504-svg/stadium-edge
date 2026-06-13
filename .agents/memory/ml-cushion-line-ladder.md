---
name: Moneyline cushion line-ladder (PickCard)
description: How the mobile PickCard Safe/Best/Value ladder surfaces alt-spread cushions for moneyline picks
---

# Moneyline cushion rungs in the PickCard line-ladder

The mobile PickCard Safe·Best·Value ladder (shown on Coach, Home, Props, Slip)
used to show BEST only for a moneyline, because an ML has no alternate line in its
own market family. We now offer the book's REAL posted **spread / Alt Spread**
rungs on the SAME team that give it **+1..+20 points** as the Safe/Value tiers:
within that band every rung is strictly safer than the ML (the ML needs an outright
win; a +point spread also cashes on a narrow loss).

**Decisions worth keeping:**
- **TWO disjoint price bands → `chooseMlCushionTwoBand(rungs, floorOdds)`** (the
  user iterated: first plus-money-only, then settled on "show BOTH"):
  - **Value** = highest-PAYOUT **plus-money** rung (odds ≥ `ML_CUSHION_MIN_ODDS`
    = +100): adds points AND pays better than even — the genuine edge play. Tie →
    deeper cushion (more points).
  - **Safe** = the **DEEPEST minus-money** rung (most points, e.g. a +2/+3 line)
    priced no worse than `CUSHION_FLOOR` (-550, passed in from PickCard); you lay
    juice for a lower payout but it rarely loses. Tie → less-negative odds.
  - Bands are disjoint by price, so Safe and Value never collide; each is
    independent/nullable (card shows one, both, or neither = BEST only).
- **Value is by ODDS not line** — a book can misprice/stale a rung so the
  shallowest line is not the best payout; Value must be the genuinely better price.
- **WHY grade ≠ cushion depth:** user asked "why not give +2/+3 to get an A
  grade?" — the AI Grade comes from the 5-component pickScore rubric
  (matchup/trend/line-value/injury/line-shop, all REAL), NOT from how many points
  you buy. Deeper points just cost juice (minus-money) and don't raise the grade;
  you can't manufacture an A on a negative-edge card without fabricating. Explain
  this, never fake it.
- **Honesty:** REAL posted rungs only; no posted +point spread in band → BEST
  only, never fabricate.
- **Period prefix is preserved** (moneyline→spread within the same period) so a
  "Q3 ML" pick only pulls Q3 spread rungs, never the full-game spread.
- Mutual exclusivity is automatic — the existing cardLegs/siblingLegKeys already
  enumerate the cushion/value rungs (each carries its own `market`), so selecting a
  cushion clears the ML leg and vice-versa.

**Why:** user asked to offer +1..+20 point alt-spread "cushion" rungs on ML picks
everywhere the line ladder shows.

**How to apply:** this is the CLIENT line-ladder render path, independent of the
Coach prompt-side ML→Alt-Spread conversion (safe-underdog-cushion-spread.md) and the
bare-alt PROP rung swap (mobile-bare-alt-prop-cushion.md) — same "cushion" theme,
different mechanisms. The pure tier-selection (`chooseMlCushionTwoBand`) lives in
`lib/mlCushion.ts` and IS unit-tested (node --test); the surrounding pool filtering
stays in PickCard.tsx (RN imports, not node-testable), so keep selection logic in
the lib so its Safe/Value contract stays locked.
