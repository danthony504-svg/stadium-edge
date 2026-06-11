---
name: Value Edge value bets (mobile arbitrage screen)
description: Mobile "Arbitrage" screen renamed "Value Edge"; adds a +EV value-bet section below guaranteed arbs, real-prices-only; near-term horizon so out-of-season slates posted months early don't show.
---

The mobile `app/(tabs)/arbitrage.tsx` screen is user-facing **"Value Edge"** (was briefly
"Edge Lock") but the route/file/`Stack.Screen name` stay `arbitrage` (lower-risk; only the
NavMenu label and on-screen copy changed). It shows two stacked sections from ONE scan:

1. **GUARANTEED ARBITRAGE** (green) — existing `ArbCard`, combined implied prob < 100%.
2. **VALUE BETS** (amber `#f59e0b`, "NOT a guaranteed win") — single real price that
   beats the no-vig consensus fair value (+EV).

**Honesty boundary (the whole point):**
- Game-line value = `findGameLineValueBets` computes a no-vig **median** consensus per
  side from each outcome's REAL per-book `books[]` distribution, emits the single
  strongest +EV side. Needs ≥ `MIN_VALUE_BOOKS` (3) books.
- Prop value = `findPropValueBets` **reuses server-precomputed** `ev/evSide/fairProb/books`
  on `PlayerProp` (mains only — props feed has only best-over/best-under, so the client
  CANNOT recompute a prop's fair line). Never recomputed client-side, never fabricated.
- Band gate: `MIN_VALUE_PCT=2` .. `MAX_VALUE_PCT=12` (absurd edges = stale/mismatched line, drop).

**Aggregation gotcha:** value bets are SUPPRESSED when their
`${game}|${marketKey}|${player ?? ""}` matches a guaranteed arb's market (don't show the
same matchup as both). Values sorted by `edgePct` desc, capped ~40.

`scanArb` now returns `{ arbs, values }` (was a bare `ArbOpportunity[]`) — both the
`useQueries` queryFn return type and the aggregation `useMemo` consume `q.data.arbs` /
`q.data.values`.

**Near-term horizon gotcha:** game-line arbs/values had NO horizon filter, so the Odds API's
genuinely-real but far-out slates (e.g. NFL Week 1 posted in June, 3 months out) appeared with
`formatStart` showing only weekday+time ("Sun 12:00 PM") → looked like THIS week. Fix = filter
`getOdds` to a near-term window (`GAME_HORIZON_H = 10*24`, same `now-4h` lower bound) BEFORE
findGameLine*; props path already had its own 48h/soccer-14d gate (that's why only game-line arbs
leaked). Also added month+day to `formatStart` so dates are never ambiguous. The data was real —
the bug was scope+display, not fabrication.

Web (stadium-edge) has **no** arbitrage page — this is mobile-only. api-server prop `ev`
fields were already real (no server change needed).

Tests: `lib/arbitrage.test.ts` via `node --test 'lib/**/*.test.ts'` (96 total after +4).
