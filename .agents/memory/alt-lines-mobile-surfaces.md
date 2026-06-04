---
name: Alt/period lines on mobile surfaces
description: How real alternate ladders and game-level period markets get surfaced (not fabricated) across the three Expo display surfaces.
---

The feed already carries everything — the gap was display-only. `/sports/odds`
returns `markets:[...mains, ...alts]` incl. `alternate_spreads/totals`, period
markets (`spreads_h1/h2/q1-q4`, `totals_*`, `h2h_*`, `alternate_*_h1`); props
endpoint flags alt rungs with `alt:true`. Three surfaces show them:
game detail, the Props tab row expander, and the Player Props sheet hit-rate explorer.

**Rule: never price away from a real rung.** Every Over/Under price shown/added
must come from an actual posted rung (`overPrice/underPrice`), never an estimate.
Between rungs → no price + explicit guidance text.

**Pick-string parity is the invariant that makes dedupe work.** A leg added from
any surface must match the canonical strings `buildPicksFromOdds` (api.ts) emits,
or it won't dedupe against Coach legs:
- Game markets: market title == slip string ("Alt Spread", "1H Total",
  "Q2 Moneyline", "1H Alt Spread"…); pick depends ONLY on the base family
  (ML / spread w/ sign / total bare number).
- Player props: market="Player Prop", pick=`${player} ${side} ${line} ${label}`
  with `label=propMarketLabel(market)`; the side token is ALWAYS present (even
  yes/no markets where line is "").

**Sheet rung mechanics:** `selectedProp` prefers the non-alt main (book line for
the AI suggestion + chart seed). `rungs` = all priced rungs for the market.
`rungAt` = the rung exactly matching `chartLine` (0.01 tol) — pricing/add is
fail-closed to it. Alt lines can step by 1 (not 0.5), so a "Posted lines · tap to
price" chip row makes every rung one tap away; the ±STEP stepper alone may skip them.

**Why:** user asked "why no alt totals/spreads/points/yards?" → all of the above.
The data was there; the UI only rendered mains.
