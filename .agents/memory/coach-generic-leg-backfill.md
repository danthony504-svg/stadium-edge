---
name: Coach plain N-leg reach-the-count backfill
description: Why a generic N-leg parlay returns short and how the deterministic backfill fills it without widening locked asks
---

# Coach plain N-leg reach-the-count backfill

The mobile AI Coach (and same class on web) routinely returns a leg or two SHORT
of an explicit leg count even when the real board has plenty more games — the
model ignores the prompt's REACH-N rule. The deterministic `backfillPicks`
backstop is the real guarantee, NOT the prompt.

**The gap that bit us:** the backstop only ran for `altSign` and `includePeriods`
requests. A PLAIN N-leg parlay (no alt / period / odds-threshold lock) had NO
backfill branch, so a "4 leg" ask that resolved to 3 stayed at 3 and showed the
"only 3 held up" honest-short note — even though the slate had many more real
games. The fix adds a generic branch filling toward N from real full-game mains.

**Why derive constraints from the model's OWN resolved legs (not NL parsing):**
the mobile client has no game-lock / props-only / market-lock intent helpers
(that lives server-side in chat.ts buildChatContext). So the safe signal is the
shape of what already resolved:
- every resolved leg `isProp` → SKIP generic backfill (props-only / prop-market
  intent; a game-level main would be off-intent).
- all game-level legs on ONE game → restrict the fill pool to that game
  (single-game lock; don't pull other matchups).
- all game-level legs in ONE full-game family (all spreads / all MLs / all
  totals) → constrain the backfill order to that family (implicit market-lock,
  e.g. "spread parlay"); else fill from all three mains.

**How to apply / invariants:**
- Backfill ONLY appends real `context.realOdds` entries — never fabricates — and
  reuses `backfillPicks`' famSeen/legSeen dedup + period-scoped anti-correlation.
- Gated on requestedLegCount > 0 (explicit count) so unsized asks (safe ticket,
  random ticket) are naturally excluded and never padded.
- The honest legNote still fires if the real board genuinely can't reach N.
- The lock heuristics relax toward FILLING (the user's intent) on the rare
  one-leaked-leg case; that's the deliberate conservative direction.
