---
name: Tennis player stats sheet
description: Why the mobile tennis player stats sheet differs in shape from other sports' sheets, and where its real data comes from
---

# Tennis player stats sheet

Tennis players get a tappable stats sheet (opened from the matchup card on the
mobile game-detail page) — the tennis analog of other sports' player sheet.

**Why the shape differs (durable):** ESPN tennis has NO per-match box-score feed
— no aces / serve% / double-faults; competitor objects carry only set linescores
behind per-set `$ref`s (too heavy to fan out). So the sheet is **bio + ranking +
career singles record + recent form**, NOT game-log bars like NBA/NFL. This is a
data limitation, not a design choice — never fabricate per-match stats to make it
look like the other sports.

**Real-data gotchas:**
- Career stats come ONLY from the all-time `athletes/{id}/statistics` splits
  (the season-scoped statistics endpoint errors). Available keys: singlesWon,
  singlesLost (→ W-L + computed win%), singlesTitles, doublesTitles, prize.
- Players outside the ranked list still resolve via the scoreboard, with
  rank/rankPoints honestly null. Every field absent from ESPN is omitted, never
  guessed.
- Reuses the matchup path's rankings+scoreboard resolution (see tennis-matchup.md
  for the athleteId / linescores ESPN gotchas). api-server has NO watcher —
  restart it after server edits.
