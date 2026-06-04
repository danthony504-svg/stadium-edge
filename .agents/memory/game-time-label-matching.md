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

**Rule:** `sameGame()` is token-overlap only (no sport guard, first-match), so
the time lookup MUST scope candidates by sport AND require EXACTLY ONE match
before assigning `startsAt` — otherwise an ambiguous label (same-city
cross-sport, same-teams doubleheader) borrows the wrong fixture's time. Prefer
omitting the time over showing a possibly-wrong one.
