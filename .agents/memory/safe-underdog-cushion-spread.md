---
name: Safe underdog → cushion alt spread
description: Coach default-converts plus-money underdog MLs to a same-team Alt Spread cushion rung; prompt-only, carve-outs for value/upset.
---

# Safe underdog → cushion alt spread

When the Coach would back an UNDERDOG straight up (the plus-money / longer-priced ML
side), it now DEFAULTS to that same team's Alt Spread rung with extra points (a
cushion) copied verbatim from realOdds, instead of the bare dog ML. Same side
(winner unchanged), lower variance.

**Why:** user asked "on your moneyline picks for an underdog can you make it safe,
just do an alt plus points?" The dog ML is the highest-variance way to back a dog;
a deeper spread cashes on an outright win OR a loss-by-less.

**How to apply:**
- Implemented PROMPT-ONLY in chat.ts SYSTEM_PROMPT, placed between MONEYLINE
  CONSISTENCY and UPSET ALERT. Governs BOTH web and mobile AI and keeps prose+card
  consistent (no client swap → no prose/card mismatch).
- The cushion rung is already in context for both surfaces, so the prompt has a real
  rung to land on: mobile buildRealOdds surfaces ONE alt-spread rung per side nearest
  even money (= a points cushion for the dog); web carries the full ladder. This is
  why game-level alt selection is done via prompt + in-context rungs, NOT a
  deterministic client swap — client swaps in this codebase are reserved for PROPS
  (no game log in context). Same lever as VALUE-OVER-CHALK / UPSET / ML CONSISTENCY.
- Honesty: if realOdds carries no alt-spread rung for that dog, keep the ML and say
  no cushion was posted — never fabricate a point/price.
- It changes only MARKET/RUNG, never WHO — MONEYLINE CONSISTENCY (mlLean.side) still
  fixes the side; EDGE note still cites mlLean.reasons.
- CARVE-OUTS keep the straight dog ML (payout is the point): longshot/boom/lottery,
  value/plus-money/+alt/upside asks, odds-bound plus-money asks, and UPSET ALERT
  spots being surfaced. Note UPSET ALERT can still force one true dog ML on
  mixed-intent asks — intentional.
- api-server is build+start (no hot reload) — restart the API workflow after any
  chat.ts prompt edit or it serves stale compiled code.
