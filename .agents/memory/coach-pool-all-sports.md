---
name: AI Coach parlay pool spans all sports
description: Why the mobile Coach's DEFAULT_SPORTS is the full SPORTS list, and why that's cheap
---

The mobile AI Coach builds its parlay context from `DEFAULT_SPORTS` (lib/sports.ts).
It used to be a hand-picked subset of 5 (mlb/wnba/nba/nhl/soccer), which made the
Coach feel like it "only knows MLB and NBA" — NFL, college football/basketball,
UFC, and tennis games existed in the feed but never entered the pool. Now
`DEFAULT_SPORTS = SPORTS.map(s => s.id)` so every surfaced sport is eligible.

**Why this is safe (cost is bounded by the live window, NOT raw game count):**
- The context build keeps only in-progress + next-48h games (`isPickable`), so an
  off-season league that returns 75 raw fixtures contributes ~0 actual pool legs.
- The odds route caps the expensive per-event alt/period fan-out at the first 12
  within-48h events per sport (`.slice(0,12)` "cap credit spend") and caches ~5 min.
- Adding a sport therefore just adds a couple more cached parallel `getOdds`/
  `getGames` calls, not a linear blowup in Odds-API credits or latency.

**How to apply:** don't re-narrow DEFAULT_SPORTS to "fix" perceived noise — the
window filter already keeps out-of-season sports empty. UFC/tennis are
moneyline-only and carry no props (not in PROPS_SPORTS), but their game-level ML
legs are valid pool entries; the props-mandatory prompt rule is satisfied by props
from the prop-capable sports in the same ticket. No prompt change is needed — the
SYSTEM_PROMPT already treats realOdds/realGames/realProps sport-agnostically.
