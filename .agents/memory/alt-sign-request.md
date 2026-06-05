---
name: "+ alt" / "- alt" sign lock (mobile Coach)
description: Forcing every parlay leg onto plus-money or minus-money rungs when the user asks for "+ alt" vs "- alt".
---

# "+ alt" / "- alt" odds-sign lock

A "+ alt" (or "plus alt") ask must put EVERY leg on plus-money rungs; "- alt" (or
"minus alt") must put every leg on minus-money rungs. A bare "N leg alt" keeps the
existing cushion default. Never fabricate a wrong-sign rung — drop instead.

**Why:** users treat "+ alt" as the aggressive upside ticket and "- alt" as the
safe deep-juice ticket; a mixed-sign slip (what bare alt produced) defeats the ask.

**How to apply — three layers, all mobile, all gated on `!oddsThreshold`** (a
threshold already implies the sign and takes precedence):

1. **Game-level alts** are the real gap: mobile emits ONE rung per side
   (`bestRungPerSide`, closest-to-even), so the model can't choose the sign. Thread
   `AltSign` through `buildChatContext → buildRealOdds → bestRungPerSide`; skip rungs
   on the wrong sign. A side with no matching-sign rung is simply omitted.
2. **Props** are best-effort at resolve time: map `altSign` → `AltRungBias`
   (`plus`→`value`, `minus`→`cushion`); the matchProp swap maximizes right-sign
   retention but can keep a wrong-sign rung when the player's ladder has none.
3. **Hard guarantee:** a post-parse filter on resolved `picks` drops ANY leg (prop
   or game) left on the wrong sign — this is the only thing that makes the "EVERY
   leg" promise true. Surface a transparency note when it drops legs / leaves zero.

**Under-fill gotcha (the second bug):** once layer 1 worked, a "- 9 leg alt" came
back honest-short at 8 even though the slate had 24+ minus alt legs. Cause: prop
SIDES surfaced to the model in `buildChatContext` were gated only by `oddsThreshold`,
NOT by `altSign`, so the model kept picking wrong-sign props that layer 3 then
stripped → short ticket. Fix: gate the prop `over`/`under` side qualification on the
sign too (same place as the threshold gate: `sideQualifies(price)` checks
`altSign === "plus" ? price>0 : price<0`), and `continue` when `(oddsThreshold ||
altSign)` and neither side qualifies. Now the model only ever SEES right-sign prop
sides, so nothing gets dropped and the ticket fills. **Lesson:** any post-parse
"drop wrong X" filter must be paired with a context-level filter that hides wrong-X
options from the model, or it silently under-fills instead of mis-filling.

**Reach-the-count gotcha (the third bug):** even with sign filtering correct, a
"- 9 leg alt" still came back at 8 — all Alt Spreads, no alt totals, no props —
though the board had 24+ minus alt legs. The chat.ts prompt ALREADY has an explicit
"REACH N BEFORE GOING SHORT" rule telling the model to pair a game's Alt Spread +
Alt Total to reach N, and the model ignores it. Prompt-only reach-N is unreliable
(same lesson as the AI-pick safety-net). Fix: a deterministic client backstop —
now the generalized `backfillPicks(existing, realOdds, gameMeta, {target, order,
altSign})` with `ALT_BACKFILL_ORDER` (components/PickCard.tsx; also drives the
period/same-game reach-N case via `PERIOD_BACKFILL_ORDER` — see
period-intent-enforcement.md) — that, when an explicit-count alt ticket resolves
short, appends REAL sign-matched alt rungs from `context.realOdds`
— breadth-first (all "Alt Spread" one-per-game, THEN "Alt Total") — honoring the
SAME (game, marketFamily) anti-correlation dedup parsePicks uses, an exact-leg
dedup, and `target = min(requestedLegs, MAX_LEGS)`. Wired in coach.tsx after the
post-parse sign filter, before the MAX_LEGS truncation, gated on
`altSign && requestedLegs > picks.length && picks.length > 0` (requestedLegCount is
0 when no count → never force-fills a bare "- alt"). Never fabricates — only
appends entries already in realOdds. **Lesson:** "reach N" promises that depend on
the model honoring a prompt rule WILL under-fill; pair them with a deterministic
client backfill from the real pool.

**Detection gotcha (the real one):** users type the sign at the FRONT of the
message — "- 9 leg alt" / "+9 leg alt" — NOT next to "alt". So a sign-adjacent-only
regex misses it and the slip silently keeps mixed signs. Detect a LEADING sign
(`/^\s*-(?=\s|\d)/`, `/^\s*\+(?=\s|\d)/`) OR a sign next to "alt" OR the words
plus/minus, all gated on `altMentioned`. The leading "-" needs a space/digit after
it and the alt-adjacent "-" must be start/space-anchored, so a compound hyphen like
`9-leg alt` never reads as minus (and `- 9 leg parlay` with no "alt" → no sign).
