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

**Timing / horizons:** World Cup starts 2026-06-11. The props endpoint is real
and works days ahead (books post WC props ~weeks out; verified 143 real props
for the opener while ~6 days away). Because WC is a tournament whose matches
cluster outside the normal pickable window, the MOBILE PROPS TAB
(`fetchAllProps`) now uses a sport-aware look-ahead: soccer = 14 days, all other
sports keep 48h. **Why:** with the flat 48h window the Soccer tab showed an
honest-but-confusing "no props" for days even though real WC props existed.
Safe because soccer's only prop league is the WC and every WC match carries
props, so the chronological `slice(0, MAX_GAMES)` fills with prop-positive games
(no starvation). The coach pool / web 24h window were NOT changed — only the
mobile Props tab fetch.

**National-team crests + headshots (Featured Players, etc.):** WC soccer props
have NO team id / team field / headshot, odds-feed games have no logos, and ESPN
`/sports/games?sport=soccer` returns CLUB games — so the ONLY handle is the team
NAME on the odds game. Server resolves nation+crest from ESPN's closed 48-team
FIFA WC teams list (`soccer/fifa.world/teams`) and attributes each player via that
nation's ROSTER; `PlayerProp.teamLogo` carries it to the client (avatar already
falls headshot→teamLogo→initials). Durable gotchas:
- **Player name match:** odds vs ESPN differ in word ORDER + hyphenation
  ("Kangin Lee" vs ESPN "Lee Kang-In") → plain normalize misses; key the roster on
  a SORTED token set with hyphens JOINED (kang-in→kangin) so order/hyphen don't matter.
- **Team name match:** odds "Czech Republic" vs ESPN "Czechia" needs a prefix tier
  (exact/substring both fail); match layered exact→substring→5-char-prefix, each
  UNIQUE-guarded, fail-closed to null (never a guessed flag).
- **Cross-nation collisions:** merge the two rosters fail-closed — if the same
  tokenized name is on BOTH teams, suppress the crest (can't tell which player).
- Only ~8/26 nationals have a real ESPN headshot; the rest fall to the crest.

**Sync points touched:** sports.ts (add WC key), props.ts
(MARKETS_BY_SPORT.soccer + multi-key resolver), mobile lib/api.ts
(PROP_MARKET_LABELS + add "soccer" to PROPS_SPORTS), web ParlayBuilder.tsx
(4 label maps + YES_NO_LABEL + friendlyPickLabel isGoal + COUNTABLE regex),
chat.ts MARKET_KEYWORDS.
