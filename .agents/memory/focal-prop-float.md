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

## Mobile has a SECOND focal-starve point: the props FETCH window (not just the cap)

In `stadium-mobile/lib/api.ts` `buildChatContext`, props are only fetched for the
soonest `MAX_PROP_CONTEXT_GAMES` (24) prop-capable games — `propCandidates` is
sorted purely by `commenceTime` then `.slice(0, 24)`. The cap floats (`balancePropsByGame`)
are focal-aware, but the FETCH was NOT.

**Why this bites (the "still moneyline and spread" soccer bug):** on a night with
~15 earlier MLB games, the soonest-24 fetch window fills before a LATER focal slate
(e.g. 9pm World Cup soccer) is reached, so the focal games get ZERO props fetched.
The model then only has game-level soccer markets → the "soccer parlay" comes back
as all ML/spread/total even though 400+ real soccer props (goalscorer/shots/SoT)
exist upstream. The prop mandate + never-fabricate matcher can't help when props
were never fetched into the context at all.

**Fix:** after the time-sort, float focal-slate candidates to the front of
`propCandidates` (still time-sorted within each group) BEFORE the slice, using the
same `focalSportsFromText` + `gameMatchesFocalText` predicate the cap and the
matchup-history target ordering already use. `focalText` is the user's raw message
(arg 6 to buildChatContext). So: cap-float and fetch-float are TWO separate places;
a focal-starvation symptom on mobile may need the fetch-float, not a cap bump.
Client-side change → reaches users via a new native build / OTA, not the server.
