---
name: Player-vs-opponent matchup history
description: How chat surfaces a player's REAL prior-meeting stat lines vs a named opponent, and the opponent-resolution rules that prevent mixing teams.
---

## Player-vs-opponent stat lines in chat (prior meetings this season)

A chat ask like "how many points did LeBron score against the Thunder" should show
that player's REAL per-game lines from this season's prior meetings — including games
older than the last-10 window the normal stat card shows.

**Flow:** `parseStatLookup` captures an opponent after `vs/versus/against/@` (strip
stat-nouns/season/filler/"the", keep 1–3 words; also remove those tokens from the
player NAME so ESPN's fuzzy search doesn't bind to the wrong athlete). Client passes
`&opponentName=` to `/api/sports/player-history`; server returns `vsOpponent` +
`vsOpponentName`. `PlayerStatCard` renders a "vs <Opp> · <season> · N meetings" table
above the full log (honest amber note when zero meetings). `histText` serializes the
vs-opponent lines so chat follow-ups stay grounded.

**Opponent resolution is the sharp edge — never substring-match.** Match the hint
against the opponent display names ALREADY in the player's own `flat` log (no global
team DB → can't fabricate). Score each UNIQUE opponent on EXACT token equality only:
nickname (last word) = +3, other exact token = +1, full-name exact = +5. STOP-drop
connectors/generic tokens (the/and/of/at/vs/fc/sc/team/city/state); hint tokens ≥3
chars. Commit only to the single best candidate that STRICTLY beats the runner-up
(sort score desc + name asc for determinism; tie = >1 candidate at top score →
return nothing).

**Why:** loose substring matching mixed teams — "and" ⊂ "ClevelAND", "new" matched
both New York and New Orleans. Exact-token + nickname-weight + unique-winner fixes it;
ambiguous hints ("LA" → Lakers vs Clippers) honestly return nothing rather than guess.

**How to apply:** any new free-text→team resolution in this codebase should reuse this
pattern (exact tokens, nickname weight, strict unique winner), never substring. Server
route `/api/sports/player-history` already had an unused `opponentTeamId` exact filter;
`opponentName` is the fuzzy sibling. Limitation: city abbreviations (okc, gsw, NY)
don't resolve — needs the full nickname or a city word ≥3 chars.

## Period stats vs a named opponent (Q1/H1 etc. — separate path)

A PERIOD ask scoped to an opponent ("how many points did Wembanyama score in the
FIRST QUARTER vs the Knicks in their last few games?") does NOT use ESPN game logs —
ESPN carries full-game totals only. It routes through `parseStatLookup`'s period
branch (`lookup.period && lookup.opponent`), NOT the raw "game by game" branch (that
branch now excludes opponent asks via a `hasOpponentAsk` guard so they reach the
verified path).

**Two real sources, joined on DATE not abbreviation:**
- ESPN `/api/sports/player-history?opponentName=` → this-season meeting DATES +
  `vsOpponentName`.
- StatMuse per-game grid via phrasing `"<player> <period> <stat> against the <opp>
  game by game"`. **StatMuse IGNORES opponent filters when "last N games"/"this
  season" is in the query, but DOES honor "against the <opp> game by game".**
- Keep only StatMuse rows whose date matches an ESPN meeting date **within ±1 day**.

**Why date-intersection, not team abbreviation:** ESPN and StatMuse abbreviate teams
DIFFERENTLY (ESPN "NY" vs StatMuse "NYK", GS/GSW, NO/NOP, SA/SAS, WSH/WAS). Exact
abbr match false-negatives and drops real rows; prefix match breaks on WSH/WAS. Dates
are the one key both sources agree on. **±1 day is mandatory:** ESPN stores UTC
(2026-01-01T00:00Z) but StatMuse uses US-local (12/31/2025) → off by one. Bonus:
date-intersection is self-guarding — if StatMuse ignores the opponent and returns a
generic log, none of those dates line up → honest note, never wrong-team data (the
reported bug was the period path showing the generic last-10 regardless of opponent).
Server needs NO new fields (vsOpponentName + vsOpponent[].date already exist); an
abbr-field experiment was reverted as dead code.

**Opponent EXTRACTION is the other half of the same bug.** `parseStatLookup` must
capture ONLY the team phrase right after vs/against by taking leading word tokens and
STOPPING at the first connector/time/stat stopword (in, their, last, this, few, games,
tonight, season, score…), capped at 3 tokens. The old approach grabbed the whole tail
`(.+)$` then length-rejected >3 words, so normal phrasing "vs the knicks in their last
few games" → "knicks their last few games" (5 words) → null → generic wrong-team
fallback. Belt-and-braces: in the period branch, if the text has a vs/against marker
but `lookup.opponent` didn't resolve, show an honest "which team?" note — never fall to
the generic last-10 query.
