---
name: ESPN scoreboard date ranges are broken
description: Hyphenated ESPN ?dates=YYYYMMDD-YYYYMMDD returns 400; use per-day dates for /sports/games.
---

# ESPN scoreboard date ranges are broken (2026-09)

ESPN `site.api` scoreboard **rejects** hyphenated ranges:

`?dates=20260916-20260924` → HTTP 400 `"Failed to get events endpoint."`

Same for comma lists. **Single-day** `?dates=YYYYMMDD` still works; bare
`/scoreboard` still returns the default slate.

## Impact
`api-server` `/sports/games` used a range query and **threw** on 400, so the
route’s outer catch returned `[]` for every ESPN sport (CFB/NFL/MLB/NBA…).
Simulator CFB showed “No upcoming games” even though odds still had 90 NCAAF
events and ESPN default had ~22 CFB games.

## Fix
`lib/espnScoreboardWindow.ts` + `routes/games.ts`: fetch yesterday..+7 UTC days
individually, merge by event id, fall back to default scoreboard if empty.
Never let a ranged/day miss abort the whole sport.
