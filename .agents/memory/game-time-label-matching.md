---
name: Chat card game time/date label matching
description: Why scheduled time/date silently drops off chat pick cards — exact-string feed lookups vs AI label variants; use tolerant matcher.
---

# Chat pick-card time/date silently missing

Chat pick cards show the game time/date via
`formatGameTime(lookupGameStart(pick.game))` (and a live 🔴 tag via
`lookupLiveTag`). These lookups resolve the AI's `pick.game` label against the
live feeds (`realGamesBySport`, `realOddsBySport`, `livePicks`).

**Bug:** they matched with EXACT string equality
(`` `${g.awayTeam} @ ${g.homeTeam}` === gameLabel ``). The AI's label routinely
uses a different team name form (abbr / nickname / full) or a reversed
home/away orientation, so the match failed, `lookupGameStart` returned null,
and the time/date rendered nothing — even though the matchup WAS in the feed.
A label that matches no feed at all is treated as "keep" by `gameResolvesToFinal`,
so the card still renders, just without a time → looks like "time not showing".

**Fix / rule:** match game labels with the module-level tolerant
`gameLabelsMatch()` (normalize both sides: `expandTeamToken` + lowercase +
strip non-alphanumerics, accept EITHER orientation), not exact `===`. Flip
tolerance is safe for time lookup because `lookupGameStart` already ranks
candidates future/non-final first, then non-final, then most-recent-past.

**Watch-outs:** ambiguous single-token nicknames (Rangers/Panthers/Cardinals)
aren't sport-disambiguated, so some matches can still miss; home-and-home /
doubleheader labels can resolve to the wrong orientation candidate (mitigated
by the future-first ranking).

**Process note:** the user's phrasing "Not display time and date of game" was a
COMPLAINT that it wasn't showing, not an instruction to remove it. A terse
negative sentence + a screenshot of the missing element usually means "this is
missing, add it" — confirm intent before deleting UI.

## Mobile port (Expo AI Coach)

Mobile shows the same date/time on chat pick cards, but resolves it
differently than web. The card's `ParsedPick` carries `startsAt`; it is set in
`parsePicks` by matching the resolved (canonical-feed) game label against the
per-game `GameMeta` table (built from the same ESPN feed, now carrying `sport`
+ `startsAt`). `formatGameTime()` (lib/format.ts) renders a short local
"Today/Tomorrow/<weekday>/<Mon D> + time" and returns "" on missing/unparseable
so the card omits the line.

**Rule (critical):** do NOT resolve the time with `sameGame()` (token
overlap >= 2). A multi-word city like "New York" is itself two tokens, so any
OTHER game featuring that one team scores 2 hits and falsely matches — "Toronto
Tempo @ New York Liberty" pulled 6 WNBA candidates, and a require-exactly-one
guard then drops the time on EVERY multi-word-team game. Match instead on BOTH
teams' NICKNAMES (last alphabetic token of each side: liberty/tempo/dream),
which are unique per team and consistent across the ESPN + Odds feeds, in either
orientation, scoped by sport. For the rare multi-candidate case (home-and-home
series / same-teams doubleheader) prefer exact orientation then soonest upcoming.

**Why:** the odds feed (prop/game labels) and the ESPN feed (gameMeta) use
slightly different team-name forms, so an exact label match misses; raw token
overlap over-matches. Nickname-pair matching threads the needle. Prefer omitting
the time over showing a possibly-wrong one.

**College collision + playoff series (don't conflate):** nicknames are NOT
unique in NCAAB/NCAAF (many Tigers/Bulldogs), so nickname-only can mis-assign.
Rank candidates by full-token specificity (city + nickname) first, so the
better-identified fixture wins ("LSU Tigers @ Georgia Bulldogs" beats "Auburn
Tigers @ Miss St Bulldogs"). Then DISTINGUISH two tie cases by an
orientation-independent identity key (`[norm(away),norm(home)].sort().join("|")`):
- SAME identity on multiple dates = a playoff series / doubleheader → resolve to
  the soonest upcoming game (sort upcoming-first then t-asc). Do NOT null these —
  an early version keyed ambiguity on `startsAt` and wrongly nulled every NHL
  finals-series pick.
- DIFFERENT identities tied as equally-good matches = a genuine same-nickname
  collision → fail closed (null). The collision test compares spec+orientation
  ONLY, NOT the `upcoming` flag — else a stale in-window live game (the matcher's
  past window must match `isPickable`, currently 4h) gets silently displaced by a
  future same-nickname fixture and shows its wrong time.
