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
