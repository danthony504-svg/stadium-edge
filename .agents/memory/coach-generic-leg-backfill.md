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

**The one-leaked-game-leg false-lock (fixed):** the single-game lock must be
computed from ALL resolved picks' games (props INCLUDED), not just the game-level
legs. Symptom: a 6-leg ask resolved to 2 props (different WNBA games) + 1 lone
MLB ML; the old check saw `gameLegGames.size===1` (just the MLB game) → locked
the fill pool to that one MLB game → backfill added nothing → "only 3 held up"
on a 6-game board. Likewise the implicit market-family lock must require
`gameLegs.length >= 2` in one family — a SINGLE leaked game leg never establishes
a "spread/ML/total parlay" intent, so it falls through to the generic mains order
and fills across all three families. Genuine single-game SGPs (every leg, props
included, on one game) and true ≥2-leg market locks are still respected.
**Why:** these were the conditions that let a healthy slate still report a short,
honest-looking ticket — the most-reported Coach failure.

**The LONE-resolved-leg false-lock (fixed):** even after counting ALL picks'
games, a generic ask that grounded only ONE leg (e.g. "Build me a 3-leg parlay
for tonight" → 1 Caitlin Clark prop on Fever@Liberty) trivially has
`games.size===1`, so the single-game lock fired and restricted the backfill to
that one (thin) game → ticket stayed at 1 ("only 1 held up") on a full board. A
single resolved leg can NEVER establish single-game intent. Gate the lock on
`picks.length >= 2 || gameMatchesFocalText(onlyGameLabel, trimmed)` — i.e. lock
only for a genuine ≥2-leg SGP OR when the user actually NAMED that game; else fill
from the whole board. `gameMatchesFocalText` is exported from lib/api.ts for this
(focalText === the user's `trimmed` message).

**The all-props skip false-positive (fixed):** the generic branch originally
skipped entirely whenever EVERY resolved leg was a prop (`if (!allProps)`). But a
GENERIC ask ("Build me a 6-leg parlay for tonight") that the model merely HAPPENED
to fill with all props (e.g. 2 WNBA props from different games, no game leg) then
got no game-main backfill → "only 2 held up" on a full board. Fix: the all-props
skip must be gated on actual USER prop intent, not on what the model returned. Add
a client `mentionsProps` regex (props-only phrasings + the prop-market stat words,
loosely mirroring server chat.ts MARKET_KEYWORDS) and backfill when
`!allProps || !mentionsProps`. So all-props + prop-intent stays props; all-props +
generic fills with game mains; mixed unchanged.
**Why:** the client has no server-side market-lock signal, so intent must be
re-derived from the user text — keying off the model's all-prop OUTPUT conflated
"user wanted props" with "model chose props".

**Backfilled legs need an honest edge note ("Missing ai edge", fixed):** the card
only renders the "AI Edge" pill when `pick.edge` is set (from the AI reply's
`EDGE:` line). `backfillPicks` pushes deterministic real-line legs with no EDGE,
so backfilled game mains (e.g. plain "Over 9"/"Over 8.5" totals) showed NO pill
while AI-emitted props did. Fix: `backfillPicks` attaches a STATIC honest note to
every leg it adds — says the leg is a real posted line added to round out the
requested ticket size, explicitly "not a separate model edge". Honesty-safe (no
fabricated analytical read), covers all 3 callers (ALT/PERIOD/GENERIC) at once,
survives `enrichPickMeta` (spreads ...pick), and can't overwrite a real AI edge
(backfill only PUSHES new legs, never mutates existing).
