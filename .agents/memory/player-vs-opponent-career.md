---
name: Player career-vs-opponent-team signal (cross-sport)
description: Cross-sport (NBA/NFL/NHL) "this player's career line vs tonight's opponent franchise" via StatMuse — the analog of MLB batter-vs-pitcher. Opponent-name resolution + the entity/ambiguity guards that keep it non-fabricating.
---

# Player career-vs-opponent (NBA / NFL / NHL)

The cross-sport sibling of MLB batter-vs-pitcher (see mlb-batter-vs-pitcher.md):
how this exact player has historically done vs the exact franchise they face
tonight (e.g. "LeBron 27.1 pts in 44 games vs the Thunder", "McDavid 17 G in 27
games vs Colorado"). StatMuse answers it for real; ESPN playerHistory.vsOpponent
only carries THIS-season meetings. Server-only, in `chat.ts` StatMuse enrichment;
injected as `lockedContext.playerVsOpponentCareer = [{player,opponent,sport,line}]`
with a sport-neutral PLAYER-VS-OPPONENT CAREER prompt rule (career sample = era
caveat; stack with recent form, don't override).

## Opponent name resolution (the non-obvious part)
`realGames` entries carry only the `game` LABEL + `homeTeamId`/`awayTeamId` — NOT
the team NAMES as separate fields. `realProps` carries `opponentTeamId` per player
but no opponent name. So resolve the opponent's full name by **parsing the
"Full Away @ Full Home" label** (the FULL TEAM NAME RULE guarantees that form):
split on " @ ", then pick away/home by matching `opponentTeamId` to the game's
away/home id. No new client field needed for this part.

## The guards that make it non-fabricating (all required — architect-driven)
StatMuse is a NAME-based source, so identity safety is the whole game:
1. **First AND last name must appear in the answer** — surname-only ACCEPTS a
   wrong same-surname player StatMuse resolved to (a fabricated "real" line). Match
   both tokens, diacritic-insensitive, dots stripped ("P.J."→"pj").
2. **Same-display-name collision → SKIP entirely.** Two distinct athletes with the
   same name (e.g. the two Josh Allens) cannot be told apart by a name query —
   even athleteId keying can't fix the StatMuse lookup. Build name→Set(athleteId)
   over the pool; any name backed by 2+ ids is dropped (honest no-data > wrong
   player). This required adding `athleteId` to client `realProps` (it was only on
   playerTargets before); candidates are then keyed by `id:<athleteId>#<sport>`.
3. **Opponent nickname on a WORD BOUNDARY** (not raw substring) — avoids
   "heat"⊂"heated" and forces the answer to actually be vs-that-team (a generic
   season average that ignored the opponent filter fails this).
4. Require a real number; askStatMuse already nulls boilerplate.

## Budget
Folded into the SAME single shared-deadline `Promise.all` as statmuseFacts + BvP
(third race entry) so enrichment never stacks beyond the one ~3s budget. Prefer
players named in the message, cap 6.

## Scope / honesty boundary
Gated to nba/nfl/nhl. NOT college (rosters churn). Still NOT buildable honestly:
per-POSITION defensive matchups ("center vs shooters", defender-forces-rebounds,
per-position TO rates) — no real defense-vs-position feed (opponent-defense-route.md);
reason about that flow via team-defense + pace, never per-matchup invented numbers.
