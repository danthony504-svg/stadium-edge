---
name: Finals/stale-game suppression — belt and braces
description: Where to apply the time-based safety net so ended/postponed games don't render as upcoming/live across the parlay UI
---

ESPN's scoreboard occasionally leaves a finished or postponed game stuck on a stale `status` (cache lag, suspended-but-never-resumed, postponement flag not flipped, team-name mismatch against the odds feed). Status-only filters are not enough — every render site that surfaces a game needs a **time-based safety net** alongside the status check.

**Rule of thumb:** ANY render site that shows games (live, upcoming, search results, sport detail, parlay slip leg tags) needs both:
1. Status-text final check: `final | full time | postponed | canceled | cancelled | ended | \bft\b`
2. Time cutoff: `now - startsAt > 4h` for game cards / `now - startsAt > 10min` for "scheduled" upcoming
3. **Active-status bypass** on the 4h cutoff — never hide games whose status still reads `in progress | live | halftime | end of | delay | suspend | rain | overtime | \bot\b | extra` (rain delays, NCAAF bowls, extra innings can legitimately run >4h).

**Sites that have been hit by this bug** (all must keep their filter):
- Sport detail games list
- Global search results
- `lookupLiveTag` (slip-leg red dot)
- Home **Upcoming Games** bucket — populated from the all-sports games fetch; if ESPN's status is still "scheduled" past tipoff the game lingers forever, so drop entries whose `startsAt` is >10min in the past at the `upcoming.push` site (not just at sort time, because the popularity sort weights still bubble it up).

**How to apply:** When adding a new render site or aggregator that lists games, copy the existing pattern from the nearest neighbor in the file. Do NOT rely solely on `status.includes("scheduled")` or `status.includes("final")` — both lie regularly.
