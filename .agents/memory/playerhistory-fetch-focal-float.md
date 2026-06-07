---
name: playerHistory game-log fetch focal float
description: The mobile Coach's per-player game-log fetch has its OWN capped float, separate from realProps/realOdds; floating MLB-only starves focal non-MLB players.
---

# playerHistory game-log fetch is a THIRD floated+capped pool

There are (at least) three independently floated+capped pools in mobile `buildChatContext`
(`artifacts/stadium-mobile/lib/api.ts`):

1. `realOdds` — ranked by focalText (game match > sport > rest), capped at ODDS_CAP.
2. `realProps` — `balancePropsByGame(..., focalText)` (focal-aware), capped at MAX_PROPS_IN_CONTEXT.
3. **`playerHistory` game-log fetch (`phTargets = phSource.slice(0, 40)`)** — this is the
   one people forget. It drives whether the Coach has each prop player's REAL recent
   game log (recency = the #1 signal).

**The bug:** pool #3 used to float ONLY MLB players to the front (for batter-vs-pitcher
platoon coverage) and then cap at 40. In MLB season a busy slate fills all 40 slots with
MLB players, so a focal NBA/NFL game the user explicitly asked about gets ZERO game logs
fetched — and the Coach then truthfully says "no recent log available in the live feed"
for star players (Brunson/Bridges/Robinson) even though the api-server endpoint returns a
full 10-game log for them. Symptom looked like missing data; it was context starvation.

**Why:** the MLB float was added in isolation for platoon coverage and never reconciled
with focal-game prioritization, unlike pools #1 and #2.

**Fix / how to apply:** rank `phSource` focal-first like the other two pools —
focal game (3) > focal sport (2) > MLB (1, platoon coverage when no focal pull) > rest (0),
deterministic index tie-break, then slice(40). Reuse `focalSportsFromText` +
`gameMatchesFocalText` (already used for realOdds/realProps). Required adding a `game`
field to `playerTargets` so the focal-game match works.

**Diagnosis shortcut:** if the Coach says "no recent log / not in the live feed" for a
prominent player, curl `$REPLIT_DEV_DOMAIN/api/sports/player-history?sport=<s>&athleteId=<id>`
(search id via `?query=` not `?q=`). If the server returns a real `recent[]`, the bug is
client-side context starvation, NOT the feed.

**Web parity:** web ParlayBuilder uses a DIFFERENT float (requested-market athletes to
front, no MLB float) so it does not exhibit this exact MLB-starvation bug; it was left
unchanged. Same class as focal-prop-float / focal-odds-float.
