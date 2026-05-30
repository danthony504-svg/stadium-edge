---
name: Live-bets chat intent + live-tag rendering
description: How "give me live bets" chat intent is gated client+server, and the lookupLiveTag duplicate-label fix that stopped live cards showing future tipoffs.
---

# Live-bets chat intent

"Give me N live bets" must return ONLY currently in-progress games (with real score/period), or honestly say nothing is live — never pass off a scheduled "Today 7:00 PM" game as live.

## Client gate (ParlayBuilder.tsx sendMessage)
- `wantsLiveBets` regex `/\b(?:live|in[-\s]?play|in[-\s]?progress)\b/i` on the message text.
- In-progress set comes from `homeLiveGames` (real ESPN scoreboard, already finals-excluded / isLive only). Match the realGames/realOdds/realProps pool against those labels with **tolerant `gameLabelsMatch`**, never `===` (ESPN vs Odds-API label forms differ).
- Filter ctxGames/ctxOdds/ctxProps to live-only, mark each `live:true` + awayScore/homeScore/periodLabel/clock. Set `context.liveOnly`, `context.liveGameCount`. When `liveGameCount===0` the upcoming pool is KEPT in context (so the AI can offer pre-game) but `liveOnly` is still set so the server tells the truth.

## Server gate (api-server chat.ts)
- Reads `context.liveOnly / liveGameCount / realOdds / realProps` (context zod is `record` passthrough, so new keys survive).
- **Branch FIRST on `liveGameCount`, never conflate "no live games" with "live games but thin odds":**
  1. `liveGameCount===0` → "NOTHING IS LIVE" honesty branch.
  2. `liveGameCount>0 && (odds+props)>0` → "LIVE BETS ONLY" (pick only live:true, respect scoreboard, shorter ticket / props-only OK).
  3. `liveGameCount>0 && (odds+props)===0` → "GAMES ARE LIVE BUT NO LIVE LINES" (lines pulled mid-sequence; don't backfill with scheduled games; suggest retry).
- **Why:** original code keyed the "nothing live" message on `liveOddsCount===0`, so live games with a momentarily-empty odds feed were wrongly told "nothing is live". Architect HIGH finding.

## lookupLiveTag duplicate-label fix (the actual display bug)
- Symptom: live-bets cards rendered a FUTURE time ("Tomorrow · 5:40 PM") even though the AI text cited live scores.
- Root cause: `lookupLiveTag` returned on the **first** `gameLabelsMatch`. A team pairing can appear twice (MLB doubleheader / next-day series rematch, same "Away @ Home" label). A SCHEDULED duplicate hit first → `isScheduled` → returned null → render fell to `lookupGameStart` which returns the soonest FUTURE candidate = tomorrow's tipoff.
- Fix: scan ALL matches, `continue` past final/scheduled duplicates, return `🔴 <periodLabel||status>` for the in-progress instance; null only if no live copy. Same precedence the playoff-series fix already gave `lookupGameStart`.
- Render (chat pick card ~7392) checks `lookupLiveTag` first, then `lookupGameStart`, so fixing lookupLiveTag alone fixes the display. `realGamesBySport` (from `/api/sports/games`) carries status+periodLabel, so the live copy IS present to find.

**Belongs to the same duplicate-label class as `playoff-series-duplicate-labels.md` — any new label-keyed lookup must prefer the live/future instance, not first-match.**
