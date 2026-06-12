---
name: Tennis spreads/totals + Table Tennis moneyline
description: Which markets each individual-sport carries and where they come from; why tennis enrichment was server-only.
---

## What's real per sport
- **Tennis**: match winner (h2h), game spread (handicap), Total Match Games (totals) — ALL real from the Odds API bulk `/odds` call with `markets=h2h,spreads,totals`. Per-tournament keys (e.g. `tennis_wta_queens_club_champ`) rotate weekly, resolved dynamically. NO set betting / set winners / "win a set" — Odds API returns INVALID_MARKET for those, so they'd be fabrication. NO halves/quarters → tennis is in `skipAltPeriod` (skips per-event alt/period fetch) but still gets mains from the bulk call.
- **Table Tennis** (`tabletennis`): moneyline ONLY. No Odds API coverage → empty `ODDS_SPORT_KEYS` entry forces the Bovada fallback (`BOVADA_PATHS.tabletennis = "table-tennis"`), which lists only the match moneyline. It's the only sport using `moneylineOnly` now.

## Server-side levers (odds.ts)
- `moneylineOnly` = `tabletennis` only → `bulkMarkets="h2h"`.
- `skipAltPeriod` = `moneylineOnly || tennis` → empties the `upcoming` per-event alt/period fetch.
- Tennis enrichment was **server-only**: both web ParlayBuilder (isIndividual → "Match Markets") and mobile game/[id].tsx render h2h/spreads/totals GENERICALLY, so no client UI surgery was needed beyond adding the sport to the SPORTS lists + isIndividual.

**Why:** keeps the HONESTY rule — only request markets the feed actually carries. Requesting set markets or period ladders for these sports would 422/INVALID_MARKET and force fabrication.

**How to apply:** to add another moneyline-only sport, add it to `moneylineOnly`; to add a sport with real mains but no periods, add it to the `skipAltPeriod` clause. Tennis/table tennis are excluded from mobile `PROPS_SPORTS` (no props) and have no ESPN feed (honest-empty injuries/matchup history is fine).
