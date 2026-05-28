---
name: Opponent / team-defense route — scope and shape
description: What /api/sports/team-defense actually returns, why splits-vs-opponent aren't there, and how the offensive/defensive blocks drive prop picks.
---

The `/api/sports/team-defense` endpoint ships an **honest pass-through** of ESPN's per-team statistics feed for a single team — it does NOT pretend to have "opp allows X" splits, because those would require aggregating every opponent's box scores (which ESPN doesn't expose per team).

**Why:** earlier drafts tried to label own-team defensive output as "opponent allows" — that's misleading and silently steered the AI to wrong conclusions. The route now ships only what's real: the team's own record-derived rates + the team's own defensive and offensive output. The AI does the matchup math: "this player faces Team B, so look up Team B's profile to infer what Player will get".

**Response shape (per team, keyed by `<sport>#<teamId>`):**
- `avgPointsAgainst` / `avgPointsFor` / `pointDifferential` — from the record feed (the only real opponent-scored rate ESPN gives per team without box-score aggregation). `null` for NFL (not in their record schema).
- `defensive` — the team's own defensive PRODUCTION: forced turnovers, sacks, blocks, steals, INTs, DREB, ERA/WHIP, goalsAgainstAvg, etc. High = disruptive defense → opp props lean UNDER.
- `offensive` — the team's own OFFENSIVE profile, used for **opp-side** prop reasoning. The matchup chain is: Player X (on Team A) vs Team B → look up Team B's `offensive` block → infer what Team A's players will get against the game-flow Team B creates. E.g. low NBA FG% on Team B = miss-heavy → more rebound chances for everyone → Team A rebounder OVER. High NFL passYdsPerGame on Team B = pass-heavy script → Team B's WRs get OVER on rec-yds; if their completion% is low + Team A's defense has high sacks/PD → Team B's QB pass-yds flips to UNDER.

**How to apply:** the prompt's OPPONENT-DEFENSE ANALYTICS RULE in `chat.ts` carries per-sport-per-market mappings. When changing the offensive/defensive allowlist in `defense.ts`, the prompt's per-key guidance MUST be updated in lockstep — or the AI sees new keys it has no instructions for and either ignores them or makes up reasoning. Bump the cache key version (`team-defense:...:vN`) whenever the response shape changes so old cached payloads don't serve the wrong keys.

**Strong matchup → step up to alt rung:** the route is also the input for the MATCHUP-EDGE → ALT SPREAD / ALT TOTAL rule — when offensive+defensive+playerHistory all align hard for one side, the prompt now tells the AI to step up to a better-priced alt rung (still within the -1000 ban) instead of taking the favorite-juice main line.
