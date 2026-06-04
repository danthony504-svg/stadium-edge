---
name: Mobile alt game lines + alt props port
description: How alternate spreads/totals and alternate player props reach the Expo AI Coach, and why mobile had to opt in.
---

The shared Express server ALREADY hands both alt sources to mobile — the gap was
purely the mobile data layer choosing to drop them.

- `/sports/odds` (bulk) merges per-event `alternate_spreads`/`alternate_totals`
  (plus period markets) into each game's `markets` array. So a mobile `OddsGame`
  already carries those market keys; `buildRealOdds` just has to read them.
- `/sports/props` rows carry an `alt` boolean (the server strips the
  `_alternate` suffix so an alt rung shares the SAME market key as its main —
  only the `line` value + `alt` flag differ).

**Mobile port (lib/api.ts only):**
- `buildRealOdds`: emit one rung PER SIDE closest to even money (impliedProb
  distance from 0.5), skip rungs priced `<= -1000` or whose point equals the
  main line's point, label them `"Alt Spread"` / `"Alt Total"`. One rung/side
  keeps context lean (matches web `pickBestRung`).
- Prop loop: must run TWO passes (mains first, THEN alts) because the 400-cap is
  `balancePropsByGame` round-robin **in array order** — mains pushed later would
  get trimmed. Cap alt rungs at 3 per `(player|market)` so one star's deep
  ladder can't crowd the pool. Push alts to BOTH `realProps` (alt:true) AND
  `propPool` (else the parser can't resolve an AI alt-prop pick → silent drop).

**Why no parser change:** `parsePicks`/`marketFamily` already collapse
`Alt Spread`→spread / `Alt Total`→total, `selectionMatches` requires the exact
line number, and `matchProp` matches player last-name + exact line + side. So
alt lines/props resolve fail-closed with zero parser edits.

**Dedup main+alt same family** is enforced by the SHARED server system prompt
(one-per-(game,market-family) ban) — same mechanism the web app relies on; not
re-implemented client-side.
