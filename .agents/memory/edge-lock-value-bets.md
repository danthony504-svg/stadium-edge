---
name: Edge Lock value bets (mobile arbitrage screen)
description: Mobile "Arbitrage" screen renamed "Edge Lock"; adds a +EV value-bet section below guaranteed arbs, real-prices-only.
---

The mobile `app/(tabs)/arbitrage.tsx` screen is user-facing **"Edge Lock"** but the
route/file/`Stack.Screen name` stay `arbitrage` (lower-risk; only the NavMenu label
and on-screen copy changed). It shows two stacked sections from ONE scan:

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

Web (stadium-edge) has **no** arbitrage page — this is mobile-only. api-server prop `ev`
fields were already real (no server change needed).

Tests: `lib/arbitrage.test.ts` via `node --test 'lib/**/*.test.ts'` (96 total after +4).
