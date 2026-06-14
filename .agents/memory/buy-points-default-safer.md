---
name: Safe vs Value line options (game-side picks)
description: Coach shows Safe (bought-points) and Value rungs as SEPARATE options; the BEST pick stays the edge line; buying points must never inflate Confidence or AI Grade.
---

# Safe vs Value line options — never fold safety into the numbers

For full-game game-side legs (Spread / Total / Moneyline) the Coach SURFACES a
cushion as a separate OPTION rather than forcing it as the pick:
- **BEST** = the line the real signals/edge support — the actual PICK stays here on
  ordinary "give me a pick / build a parlay" requests (do NOT default-swap the pick
  onto the cushion).
- **SAFE** = a real same-side rung that buys points (favorite fewer points, dog more
  points, Over lower, Under higher, plus-money dog ML → cushion Alt Spread) — lower
  variance but LOWER edge and a SHORTER price.
- **VALUE** = a real same-side rung at a tougher number for a BIGGER payout.

Safe and Value are shown as separate PROSE options beside the pick (one short
"Safe / Value:" line, like the prop "Alt options:" line) — never as extra PICK lines
and never changing the leg count.

**Why:** user policy — "Keep Confidence based on real signals only (matchup, form,
injuries, line value, market agreement). Do NOT increase Confidence simply because
points were bought. Instead, show Safe and Value line options separately. Buying
points should generally reduce edge while increasing cushion, but it must not inflate
Confidence or AI Grade." This REFINED an earlier turn that had the Coach buy points
*as the default pick*; that conflated "safer" with "more confident" and biased to
chalk, so it was replaced with show-both-options. Confidence stays signals-based and
the Grade stays a value composite — a worse (bought-points) price LOWERS edge, so it
can only lower those numbers, never raise them (see confidence-vs-grade-split,
pick-score-rubric).

**How it was done:** PROMPT-ONLY in api-server chat.ts SYSTEM_PROMPT (rule "SAFE vs
VALUE LINE OPTIONS", right after COIN-FLIP DE-RISK). No client/scoring change — the
mobile PickCard already renders a Safe·Best·Value ladder where BEST = the model's
pick and the displayed Grade/Confidence are scored on the BEST parent pick, so
showing Safe/Value rungs cannot inflate them. Restart api-server after the edit
(build+start, no watcher). Reaches the published mobile app only via OTA/new build.

**Invariants / carve-outs:**
- Real rungs only (verbatim from realOdds); no rung → omit the options line, keep the
  main line, say so. Never fabricate a point/price.
- Changes RUNG not WHO — MONEYLINE CONSISTENCY (mlLean.side) still fixes the winner.
- Excludes PROPS (own balanced cushion/value ladder — don't cushion-bias the ticket)
  and PERIOD legs (mains per PERIOD ALT-RUNG DISCIPLINE).
- Pick-side preference by intent: explicit "safe"/"low-risk" → Safe rung becomes the
  pick; explicit value/plus-money/longshot/+alt/upside or odds-bound plus-money or an
  UPSET ALERT spot → Value/aggressive line becomes the pick; otherwise BEST.
- COIN-FLIP DE-RISK remains a narrower carve-out that still prefers the safer rung as
  the PICK for genuine coin-flip legs.
