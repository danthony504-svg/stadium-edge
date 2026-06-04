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

**Alt-rung selection must be THRESHOLD-AWARE.** Picking the rung closest to even
money is the WRONG end of the ladder for an odds-bound ticket: "-300 or less"
(atMost) is built from JUICED rungs (buy points → heavy favorite), "+300 or
more" (atLeast) from the LONG end. Even-money-only selection starves these
tickets (real symptom: "10 leg -300 or less" → 1 leg).
**Why:** mobile `buildChatContext` is otherwise query-blind; the AI only ever
sees rungs the context chose to surface, and the post-parse `oddsSatisfiesThreshold`
filter can only drop, never add, so if no qualifying rung is in context the
ticket can't fill.
**How to apply:** thread `parseOddsThreshold(trimmed)` (lib/format.ts:
atMost→odds<=signed, atLeast→odds>=signed) coach.tsx → `buildChatContext` →
`buildRealOdds`. Under a threshold, FILTER alt rungs to `oddsSatisfiesThreshold`
and pick the LEAST-EXTREME qualifying rung per side (cost = |price - signed|),
not closest-to-even. Same gate on the prop alt-pass (keep rung if over OR under
qualifies). Still ≤1 rung/side so the realOdds slice(0,120) breadth cap holds.

**The context cap must RESERVE slots for alt PROPS or the model never picks them.**
Alt prop rungs are appended AFTER every game's main lines, so a plain
breadth-balanced cap (`balancePropsByGame`, 400) exhausts itself on mains and
drops all alts before the model sees one — symptom: "why doesn't it ever use alt
props". Fix: make the balancer alt-aware — split per-game into mains vs alts,
round-robin each across games, reserve ~20% of the cap for alts (bounded by how
many exist), fill mains up to cap−reserve, then alts up to cap, then backfill
leftover mains if alts were scarce.
**Why:** the prompt already teaches cushion/value alt-prop swaps (chat.ts rule
"(A) PROP-LEVEL alts"), so availability — not prompting — was the blocker; the
context can only surface, never invent.
**How to apply:** any future trim/cap on a list that mixes mains + appended alts
needs the same reserve, or the appended class silently vanishes under load.
