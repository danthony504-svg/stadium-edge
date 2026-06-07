---
name: Coach "today/tonight" pool restriction
description: How a "today"/"tonight" Coach ask is constrained to today's local-upcoming games without fabricating, and why the post-parse filter is the real guarantee.
---

# Coach "today / tonight" intent

A "today"/"tonight" ask (and NOT "tomorrow") must restrict the mobile AI Coach to
games on the device's **current local calendar day** that have **not yet started** —
no tomorrow games, no in-progress games.

Two shared helpers in `lib/api.ts`:
- `wantsTodayOnly(text)` — true on `today|tonight`, false if `tomorrow` present
  (so "today or tomorrow" keeps the full 48h window).
- `startsTodayUpcoming(startsAt)` — `t > now` (exact tipoff counts as started) AND
  local Y/M/D equals now's. Local-time compare matches the Today/Tomorrow card labels.

**Why the post-parse filter is the real guarantee:** the client pools (realOdds,
realGames, propCandidates) are today-filtered in `buildChatContext`, but the SERVER
fresh-fetch prop backfill streams a `props` frame that can carry a tomorrow/started
prop the model picked. So `coach.tsx` re-checks every resolved leg
(`picks.filter(p => startsTodayUpcoming(p.startsAt))`) — fail-closed (missing/unparseable
startsAt → dropped). Same class as other "server backfill bypasses client pool" issues.

**How to apply / ordering:** the post-parse filter MUST run BEFORE the reach-the-count
(requestedLegs) backfill, so top-ups draw only from the already-today-filtered
`context.realOdds`. Also disable the focal-game series-lookahead widening when
todayOnly (it would re-admit non-pickable future focal games). Surface an honest
`todayNote` when legs are dropped or none remain; never pad.

JS-only change → OTA-unsafe per project policy; ships in the next native build.
