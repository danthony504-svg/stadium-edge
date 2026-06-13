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
- **Tier choice is driven by ODDS, not by the line.** Safe = the safest price
  (LOWEST odds / most juice); Value = the highest PAYOUT (HIGHEST odds). Do NOT
  pick Value as "the shallowest line" — a real book can misprice/stale an alt rung
  so the shallowest line is not the best payout, which would mislabel Value. Ties
  break to the deeper cushion (more points), then stable order.
- **Honesty:** REAL posted rungs only, `CUSHION_FLOOR` (-550) drops buried
  no-payout juice; no posted +point spread in band → BEST only, never fabricate.
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
different mechanisms. The pure tier-selection (`chooseMlCushionTiers`) lives in
`lib/mlCushion.ts` and IS unit-tested (node --test); the surrounding pool filtering
stays in PickCard.tsx (RN imports, not node-testable), so keep selection logic in
the lib so its Safe/Value contract stays locked.
