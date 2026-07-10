---
name: Cross-sport prop engine (Option B)
description: Universal prop pipeline for all sports — stats vendor, prop odds vendor, 10k sim, grade gate, learning, Coach integration
---

# Cross-sport prop engine

## Goal

For **every sport** with posted player/fighter props, analyze **every available line** (main + alt):

1. Load stats context from vendor (ESPN + optional HTTP overlay)
2. Run **10,000 Monte Carlo** simulations per prop rung
3. Compute **edge**, **EV**, **confidence**, **AI grade** (B+ minimum)
4. **Skip weak picks** — only `recommended[]` ships to Coach
5. **Learn** from pick-tracker outcomes per sport+market
6. Support **alternate lines** as first-class rungs

## Feature flag

```
PROP_ENGINE_ENABLED=1          # master switch (TENNIS_PROPS_ENABLED=1 also works)
ODDS_API_KEY=...               # team sports + combat prop probe
PROP_ODDS_VENDOR_URL=...       # HTTP overlay for tennis/UFC prop lines
PROP_STATS_VENDOR_URL=...      # HTTP overlay for deep stats (all sports)
TENNIS_STATS_VENDOR_URL=...    # tennis-specific stats overlay
```

## API

| Endpoint | Purpose |
|----------|---------|
| `GET /sports/prop-engine/status` | Enabled + registered sports |
| `GET /sports/prop-engine/analyze?sport=&away=&home=&eventId=` | Full scan → ranked recommendations |
| `POST /sports/prop-engine/analyze-batch` | Batch scan for up to 16 events |
| `GET /sports/prop-stats/match?sport=&away=&home=` | Embedded ESPN stats (+ HTTP overlay) |
| `GET /sports/tennis-props/analyze` | Legacy alias (sport=tennis) |

## Architecture

```
propEngine/
  types.ts          — PropLine, PropGrade, SportPropAdapter
  grade.ts          — universal grading (mirrors finalAiScore)
  learning.ts       — sport+market hit-rate weights
  analyze.ts        — orchestrator
  registry.ts       — adapter registry
  adapters/
    teamSports.ts   — MLB/NBA/NFL/… via Odds API + simulateProp
    tennis.ts       — ESPN stats + tennis MC
    ufc.ts          — ESPN tale-of-tape + fight prop MC
  vendors/
    teamSportProps.ts — fetch + de-vig mains
    combatProps.ts    — UFC/MMA prop probe + HTTP vendor
```

## Registered sports

- **Team:** mlb, nba, wnba, nhl, nfl, ncaaf, ncaab, soccer
- **Tennis:** tennis
- **Combat:** ufc, mma

## Quality gates

| Gate | Rule |
|------|------|
| Edge | `edgePct > 0` |
| Grade | **B+** or better |
| Simulation | `simHit ≥ 52%` OR high-risk value (`edge ≥ 4.5%`) |

Skipped props include `skipReason` — Coach must not recommend them.

## Coach context

`context.propRecommendations` — map keyed by match label, values = engine `recommended[]`.

Coach copies lines verbatim; never invents props.

## Vendor contracts

### PROP_ODDS_VENDOR_URL

`GET /props?sport=&away=&home=&eventId=` → `{ lines: PropLine[] }`

### PROP_STATS_VENDOR_URL

`GET /match?sport=&away=&home=` → partial stats overlay merged with ESPN

## Tests

`artifacts/api-server/test/propEngine.test.ts`

## Next steps

1. ~~Wire `buildChatContext` to call `analyzeEventProps` per pickable event~~ ✅
2. ~~Connect pick-tracker graded outcomes → `learning` query param~~ ✅
3. Roster resolution for team sports (athleteId in sim path)
4. ~~Props tab graded rail using `propEngine` for tennis/UFC~~ ✅
5. Confirm live Odds API tennis/UFC player market keys + configure `PROP_ODDS_VENDOR_URL`
