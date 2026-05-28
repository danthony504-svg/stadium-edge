---
name: Opponent / team-defense data sources
description: What ESPN actually exposes for "opponent allows X" per team, and the honest scope of /api/sports/team-defense.
---

ESPN's per-team feeds do NOT expose true "opponent allows" splits (e.g. "opp 3PM allowed per game", "opp pass yds allowed"). To get those you'd need to aggregate opponent box scores across the schedule — expensive per request, not worth it for a demo.

What IS available, and what the team-defense route ships:
- `site.api.espn.com/.../teams/{teamId}` → `team.record.items[type=total].stats` carries `avgPointsAgainst` / `avgPointsFor` / `differential`. This is the only true "opp scored against this team" headline number available without aggregation. **NBA/NHL/MLB carry it; NFL `record` does NOT** — for NFL these fields come back null, and the route degrades honestly.
- `site.web.api.espn.com/.../teams/{teamId}/statistics` → `results.stats.categories[]` carries the team's OWN defensive output (NBA `defensive.avgSteals/avgBlocks/avgDefensiveRebounds`, NFL `defensive.sacks/passesDefended/stuffs` + `defensiveInterceptions.interceptions`, MLB `pitching.ERA/WHIP/battingAverageAgainst`, NHL `goaltending.goalsAgainstAverage/savePct`). These are NOT "opp allows" but they are real signals of defensive pressure and pair well with player props (high sacks/g → fade pass-yds over; high ERA → favor hitter overs).

**Why a curated allowlist per sport:** the `statistics` feed dumps dozens of stats per category. We pass through only the ones useful for prop reasoning to keep the chat context budget small (each prop chat already ships realProps×400, matchupHistory, playerHistory). Adding the full category dump would balloon the payload.

**How to apply:** if the user asks for "opp 3PM allowed" or any true opp-split, do not invent — either build a box-score aggregator on top of the schedule endpoint, or honestly tell the user that's not in the live feed. The current route's `defensive` map is the team's own defensive output and the prompt tells the AI to treat it as a tie-breaker, never as a primary signal.
