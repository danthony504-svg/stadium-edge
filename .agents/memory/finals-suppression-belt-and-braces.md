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

**The CHAT AI pool is the SAME class of render site and was missing this guard.** The chat-send context builder (`isWithin24h`, `realGames`/`realOdds`/`realProps` arrays, `eligibleMatchups`, `liveOdds`) filtered ONLY by a time window (4h-back → 48h-ahead) and never checked status — so a game that tipped ~3h ago and is now final stayed eligible and the AI built a spread on it (the OKC -3 "this game is over" report). Fix lives entirely in `ParlayBuilder.tsx` chat-send: `isFinalStatusChat`, `pregameOk` (non-live: drop start time >10min in the past — this is the reliable signal when ESPN status lags / name-mismatches), `finalKeysChat` label set to cross-filter the **Odds API pool which carries NO status**, combined into `gamePickable(label,status,ts)`. Applied to prop-fetch candidates, realGames/realOdds/realProps context arrays, liveOdds, and every eligibleMatchups loop. `finalKeysChat` is label-keyed so guard it with a "clearly-future ts" check or it over-blocks MLB doubleheader game 2 (same "Away @ Home" label as game 1). Live mode keeps the 4h-back window (in-progress games stay pickable) but finals are still killed by status+label.
