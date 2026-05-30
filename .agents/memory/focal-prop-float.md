---
name: Focal game/sport prop float into AI context
description: Why and how the chat context floats a focal game's/sport's player props to the front before the 400-prop cap, so a single-game prop parlay isn't starved.
---

# Focal-game / focal-sport prop float (chat context realProps)

In `ParlayBuilder.tsx` `sendMessage`, the AI context `realProps` is assembled by
walking `mergedPropsByEvent` in worker-**completion** order (nondeterministic),
then capped with `orderedProps.slice(0, 400)`.

**Why this bites:** on a busy multi-sport night (e.g. 12 MLB games at ~165 props
each, plus WNBA/soccer) other games' props crowd the focal game out of the 400
cap. A single-game ask ("15-leg, mostly props from tonight's NBA game") then sees
only a fraction of that game's distinct players (observed ~11 of 19) and the AI
honestly shortens the ticket. Because completion order varies, the SAME ask can
return 0 props one send (focal game completed last / 429'd) and a partial set the
next — i.e. the intermittent "no props posted" complaint.

**Key facts that make the float the right fix, not a cap bump:**
- The server prompt already mandates reaching N via distinct (player×stat) legs
  and forbids claiming "only X players" when realProps has more — so the gap is
  purely that the focal game's players never *reach* the prompt.
- One single NBA game routinely carries ~19 distinct players × many markets =
  enough for a 15-leg single-game prop parlay. The per-game `slice(0,200)` keeps
  all distinct players (they appear in the first market group), so per-game cap is
  fine; the **400-total** cap + ordering is the starve point.
- Game **lines** were already floated for named games; **props were not**, and a
  bare sport mention with no team names ("nba") wasn't detected at all.

**How to apply:** before the 400-slice, bucket props by focus tier (named game
`namedGameLabelSet` = 0, sport named in message = 1, neither = 2), with the
existing requested-market float (`isReqMarket`) as the secondary key. Named game
OUTRANKS a broad sport mention so a named game isn't crowded by the rest of its
sport's slate. Sport mention via `SPORT_MENTION_RE` (deliberately omits bare
"football" as NFL/soccer-ambiguous; `prop.sport` is the short id like `nba`,
sourced from `eventToSport`/`realOddsBySportLocal` keys, so it matches the regex
keys). Buckets are populated in array order → stable.

**Gotcha:** nested empty-array literal `[[],[],...]` infers `never[][]` under this
file's loose TS; type it `(typeof realProps)[]` or the downstream context block
errors with "Property 'game' does not exist on type 'never'".
