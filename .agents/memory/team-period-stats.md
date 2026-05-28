---
name: Team period stats enrichment
description: How per-team L10 q1-q4 / h1/h2 scoring history is sourced for AI period-bet reasoning, and the ESPN-date gotcha that bit the first build.
---

Real per-team period scoring averages anchor the AI's reasoning on game-level period markets (1H Spread, Q1 Total, 1H Moneyline, etc.) instead of the old "1Q ≈ 28% of full-game" heuristic.

**Why:** Period tickets are a recurring focus and the heuristic was guessing. ESPN does NOT expose per-player per-quarter splits in any endpoint we tried (summary/boxscore only return full-game player lines), but per-TEAM linescores ARE available in the scoreboard feed for finished games — that's enough to compute a real L10 per-period average per team.

**How to apply:**
- Source = `scoreboard?dates=YYYYMMDD` linescores, NOT the team-schedule endpoint (schedule omits linescores).
- The scoreboard `dates=` filter uses the game's US local date, not UTC. A late-night UTC tipoff straddles the boundary — probe multiple candidate dates per game (UTC, -4h, -8h) and dedup by eventId to be safe.
- Sport scope is gated to the intersection of (ESPN linescore reliability) AND (our bookmaker feed actually carrying period markets to bet on). Today that's nba/nfl/ncaaf only. NCAAB has linescores but no period markets in the feed, so adding it produces context the AI can't act on and creates the appearance of a contradiction with the "refuse honestly for sports with no period markets" rule.
- Cache hard: past games never change. Scoreboard-by-date is fine at 24h, the per-team aggregate at ~2h.
- Use `periodCount = min(linescores.length across sample)` so overtime games don't skew period 4 — trim everything to regulation before averaging.
- Pack into context keyed by `<sport>#<teamId>` (same style as opponentDefense) so the AI uses the same lookup pattern.
