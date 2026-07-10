---
name: Tennis prop engine (Option B)
description: Full tennis player-prop pipeline — stats vendor, prop odds vendor, 10k sim, grade gate, Coach integration
---

# Tennis prop engine

## Goal

For every **posted** tennis player prop, the engine:

1. Loads match + player stat context (surface, form, serve/return when vendor provides)
2. Runs **10,000 Monte Carlo** simulations per prop rung (main + alt)
3. Computes **edge**, **EV**, **confidence**, **AI grade** (B+ minimum to recommend)
4. **Skips weak picks** — never forces a recommendation
5. **Learns** from graded Coach pick-tracker results (market-family weights)
6. Feeds **only passing props** into Coach as `tennisPropRecommendations`

## Feature flag

```
TENNIS_PROPS_ENABLED=1
ODDS_API_KEY=...                    # prop odds probe (Odds API)
TENNIS_STATS_VENDOR_URL=...         # optional HTTP overlay for serve/return/H2H depth
```

Without `TENNIS_PROPS_ENABLED=1`, the engine returns honest empty results.

## Architecture

```
tennisPropVendor.ts     → prop lines + stats profiles (never fabricate)
tennisPropMonteCarlo.ts → 10k sim per prop rung
tennisPropGrade.ts      → edge/EV/grade/recommends gate (mirrors finalAiScore)
tennisPropLearning.ts   → pick-tracker feedback weights
tennisPropEngine.ts     → orchestrate analyze-all → rank → filter
routes/tennisProps.ts   → GET /sports/tennis-props/analyze
mobile/tennisPropEngine.ts → client fetch for Coach context
```

## Vendor requirements (Option B)

### Prop odds vendor

Must supply per-match player props with:
- Player name, market key, line, side, American odds, book, alt flag
- Markets: aces, games won, total games, double faults (extend as books post)

### Stats vendor (`TENNIS_STATS_VENDOR_URL`)

JSON contract for `GET /match?away=&home=` merging into `TennisMatchPropContext`:

| Field | Used for |
|-------|----------|
| surface, indoor | Rate adjustments |
| servePct, 1st/2nd serve won, return pts | MC priors |
| acesPerMatch, doubleFaultsPerMatch | Poisson props |
| breakPts saved/converted | Future rubric |
| matchesLast14Days, daysSinceLastMatch | Fatigue |
| injuryFlag | Rubric + skip |
| weather wind/heat/humidity | Outdoor adjustments |
| h2h, recent form (10) | Trend + matchup scores |

ESPN provides rank/form/H2H today; serve stats require the stats vendor.

## Coach integration

When `tennisPropsEngineAvailable()`:

- `buildChatContext` attaches `tennisPropRecommendations` per pickable match
- Coach prompt: use ONLY pre-graded props from context; never invent lines
- Alt rungs: engine analyzes each posted alt; PickCard cushion/value unchanged
- Learning: mobile sends pick-tracker tennis prop outcomes in `learning` query param (future)

## Quality gates (hard)

A prop is recommended only when ALL hold:

- `edgePct > 0`
- `grade >= B+`
- `simHit >= 52%` OR high-risk value play (`edge >= 4.5%` with lower sim)

Otherwise it lands in `skipped[]` with `skipReason`.

## Tests

`artifacts/api-server/test/tennisPropEngine.test.ts` — grading + learning weights.

## Next steps

1. Contract with stats vendor (Tennis Abstract / Sportradar / internal scrape)
2. Confirm Odds API tennis player market keys per tournament
3. Wire `buildChatContext` + Coach prompt block
4. Add tennis to `PROPS_SPORTS` when vendor returns live lines
5. Props tab UI rail mirroring MLB graded props
