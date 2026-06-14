---
name: Buy points by default (safer game-side picks)
description: Coach defaults game-side legs to a safer real alt rung (buy points); confidence is left as-is, not raised by buying points.
---

# Buy points by default — make game-side picks safer

The Coach DEFAULTS every full-game game-side leg (Spread / Total / Moneyline) to a
real safer alt rung instead of the riskier main line: favorite lays fewer points,
dog gets more points, Over a lower number, Under a higher number, plus-money dog ML
→ its cushion Alt Spread.

**Why:** user asked "can you increase confidence by buying points?" and chose to
KEEP confidence as-is (signals-based conviction, NOT win-chance) while still having
the Coach actively buy points to make picks safer. So buying points lowers variance
but is explicitly told NOT to raise grade/confidence (a worse price can lower them —
it buys win probability, not a better grade). This is the honest reconciliation of
"safer picks" with the signals-based confidence model (see confidence-vs-grade-split).

**How it was done:** PROMPT-ONLY in api-server chat.ts SYSTEM_PROMPT (rule "BUY
POINTS BY DEFAULT", placed right after COIN-FLIP DE-RISK). It generalizes the
previously CONDITIONAL cushion rules (COIN-FLIP DE-RISK, SAFE UNDERDOG) into a
default. No client change — alt rungs are already in mobile context and the
never-fabricate matcher resolves them; governs web + mobile together. Restart
api-server after the prompt edit (build+start, no watcher).

**Invariants that constrain it (don't break):**
- Real rungs only (verbatim from realOdds); no rung → keep the main line, say no
  cushion was posted. Never fabricate a point/price.
- Changes RUNG not WHO — MONEYLINE CONSISTENCY (mlLean.side) still fixes the winner.
- Price sanity: roughly -110..-350, never worse than -550; skip a cushion too deep
  to add equity.
- Scope: full-game game-side legs ONLY. Excludes PROPS (own balanced cushion/value
  ladder — do NOT cushion-bias the whole prop ticket) and PERIOD legs (use mains per
  PERIOD ALT-RUNG DISCIPLINE).
- Overridden by explicit VALUE intent (value/plus-money/longshot/boom/lottery/+alt/
  upside, odds-bound plus-money, or an UPSET ALERT spot) — there the aggressive
  line/plus price is the point.
- Takes precedence over value-over-chalk's RUNG preference for game-side legs on
  ordinary "give me a pick / build a parlay / safer" requests.
