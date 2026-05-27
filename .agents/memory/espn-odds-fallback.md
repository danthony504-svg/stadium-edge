---
name: ESPN odds fallback for live games
description: ESPN's per-event summary endpoint exposes live DraftKings odds (pickcenter) even while a game is in progress — useful as a real-data fallback when a paid odds feed is quota-exhausted.
---

ESPN's scoreboard endpoint drops the `odds` field once a game tips off, but the per-event summary endpoint (`/sports/{path}/summary?event={id}`) keeps `pickcenter[0]` populated with live DraftKings (or whichever provider has priority 1) numbers: `spread`, `overUnder`, `overOdds`, `underOdds`, `homeTeamOdds.{moneyLine,spreadOdds}`, `awayTeamOdds.{moneyLine,spreadOdds}`. This is real bookmaker data, not a model estimate — safe to use as a true-data fallback when a paid odds feed (the-odds-api, etc.) is out of credits or paused.

**Why:** the no-fake-data project rule means we'd otherwise have to refuse the user's request entirely whenever the paid feed dies. ESPN's pickcenter is real bookmaker data from a different source, so it satisfies the rule.

**How to apply:**
- `pickcenter[0].spread` is the **home-team line** (negative = home favored). Mirror for away.
- Cache aggressively (15-30s) — live lines move fast and ESPN doesn't love being hammered.
- Fall back gracefully: ESPN can return an empty `pickcenter` (some leagues, some games), so the route must `res.json(null)` and the caller must treat null as "still no odds, tell the user honestly".
- Never blend pickcenter lines with paid-feed lines in the same parlay without labeling the source — different books, slightly different numbers.
