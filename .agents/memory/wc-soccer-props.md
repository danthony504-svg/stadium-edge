---
name: World Cup soccer player props
description: How soccer player props are wired and why they only exist for the FIFA World Cup
---

# World Cup soccer player props

Soccer player props exist on our feed ONLY for `soccer_fifa_world_cup`
(anytime goalscorer, shots, shots on target). Club leagues we cover
(Brazil/J-League/Serie B/Segunda/CL/Ligue 1) post NO player props in any
region — those games return honest-empty, never fabricate.

**Why:** live probing (US/UK/EU) confirmed zero club-league props even for
next-day matches; only the World Cup carries them, in US books.

**How it works (multi-key resolution):** soccer is MULTI-KEY in
`ODDS_SPORT_KEYS`. The client only sends `sport=soccer`, but the per-event
props endpoint 404s under the wrong league key. So props.ts resolves the
event's real league SERVER-SIDE: shared `fetchEvents`/`matchEvent` helpers
search each soccer league's free, 5-min-cached events list — by exact
Odds-API id when the client has one, else by full/nickname team match
(fail-closed on ambiguity). No client `league` param. Single-key sports keep
their prior name-based id-recovery path unchanged.

**Goalscorer is a true yes/no market** (name yes/no, NO point) so its
`line` is `null` — NOT the `Over 0.5` convention used by anytime-TD / HR.
Web's `YES_NO_LABEL` gate had to accept `line == null` for
`player_goal_scorer_anytime` (the `pr.line === 0.5` check alone misses it),
and `friendlyPickLabel`'s isGoal regex needed the new market key (token order
"goal…anytime" won't match `anytime.?goal`). Ingest already maps yes→over,
no→under.

**Chat MARKET_KEYWORDS ordering:** bare `\bshots?\b` also matches inside
"shots on goal"/"shots on target", so the bare "shots" entry MUST sit AFTER
both specific phrases. "goal scorer"/"anytime goal" locks BOTH
`player_goal_scorer_anytime` (soccer) AND `player_goals` (NHL) — whichever
sport is in the pool fills the lock.

**Timing:** World Cup starts 2026-06-11. The endpoint works now (curl-able),
but games only enter the coach pool / props tabs as they reach the client
windows (mobile 48h, web 24h). Do NOT widen those horizons.

**Sync points touched:** sports.ts (add WC key), props.ts
(MARKETS_BY_SPORT.soccer + multi-key resolver), mobile lib/api.ts
(PROP_MARKET_LABELS + add "soccer" to PROPS_SPORTS), web ParlayBuilder.tsx
(4 label maps + YES_NO_LABEL + friendlyPickLabel isGoal + COUNTABLE regex),
chat.ts MARKET_KEYWORDS.
