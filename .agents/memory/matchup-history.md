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
