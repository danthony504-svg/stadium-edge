---
name: Mobile detail-page real ESPN signals (injury / team-defense / usage)
description: How prop/[id] and team-pick/[id] surface real ESPN injury, coarse team defense, and a minutes usage proxy — and the fail-closed entity matching honesty demands.
---

# Real injury / team-defense / usage signals on mobile detail pages

Two mobile detail pages (`app/prop/[id].tsx`, `app/team-pick/[id].tsx`) show
extra REAL signals. No new server work was needed — `/sports/injuries` and
`/sports/team-defense` already existed and return real ESPN data.

## Sport-key gotcha
Mobile `SPORTS` ids are already ESPN short keys (`nba`, `mlb`, `nfl`, ...), NOT
the Odds API keys (`basketball_nba`). `/sports/injuries` and
`/sports/team-defense` both map the `sport` query param through the api-server
`ESPN_SPORT_PATHS` table, exactly like `team-history`/`player-history`. So the
same `sport` value those existing features pass works here too. Curling with
`basketball_nba` returns "Unsupported sport" — use `nba`.

## Honesty: entity matching must fail closed
The user is honesty-sensitive; a real number on the WRONG player/team is a
fabrication. Patterns used:
- **Injury → player**: match by normalized name, but accept ONLY when EXACTLY
  ONE player in the league carries that name. 0 matches = "not on report";
  2+ = "ambiguous, not shown" (never claim healthy when unsure which one).
- **Team resolution (defense)**: `searchTeam` then require a same-sport hit
  whose name also passes `teamNameMatches`; never fall back to `results[0]`
  (that silently resolves a different sport/team). No match → hide the section.
- **Matchup team match**: `teamNameMatches` is a word-boundary subset check
  (every word of the shorter name is a whole word in the longer), so "Lakers"
  matches "Los Angeles Lakers" but not "Los Angeles Clippers", and short tokens
  never substring-match inside unrelated names.

## Usage proxy = honest minutes, not usage rate
"Usage" is just average recent MINUTES read from the already-fetched gamelog
(find a `^min(ute)?s?$` label, parse `MM` or `MM:SS`). Hidden entirely when no
minutes label exists (e.g. NFL passing). It is NOT a possession-based usage rate
(needs team box-score totals we don't have for free) — don't relabel it as one.

## Defense scope caption
`avgPointsAgainst` is TEAM-WIDE season points allowed — the only true
"opponent allows" rate ESPN exposes per team for free. Always caption it as
"not position-specific" so it isn't read as a positional matchup edge.

## GO_BACK fix
Both back buttons used bare `router.back()`, which throws "GO_BACK was not
handled by any navigator" when the screen is opened cold (deep link / fresh
stack). Guard: `router.canGoBack() ? router.back() : router.replace("/")`.
