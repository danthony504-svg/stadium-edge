---
name: Edge Lock value bets (mobile arbitrage screen)
description: Mobile "Arbitrage" screen renamed "Edge Lock"; adds a +EV value-bet section below guaranteed arbs, real-prices-only; near-term horizon so out-of-season slates posted months early don't show.
---

The user-facing name **flip-flopped** Edge Lock → Value Edge → **Edge Lock** across
re-injected plans; the latest explicit user instruction is **"Edge Lock"**, so that is the
shipped label — do NOT revert to "Value Edge" without a newer instruction.

The mobile `app/(tabs)/arbitrage.tsx` screen is user-facing **"Edge Lock"** but the
route/file/`Stack.Screen name` stay `arbitrage` (lower-risk; only the NavMenu label and the
on-screen title changed). It shows two stacked sections from ONE scan:

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
`getOdds` to the app's standard near-term "pickable" window (`NEAR_TERM_H = 48`, `now-4h` lower
bound) BEFORE findGameLine*, and the prop path reuses the SAME `nearTerm` set (dropped the old
soccer-14d special-case). Also added month+day to `formatStart` so dates are never ambiguous.
**Why 48h not wider:** user rejected BOTH out-of-season NFL (Sept) AND merely-days-out soccer
(Jun 16/17) — edges days out are stale/unactionable; keep the board to imminent games only. The
data was real — the bug was scope+display, not fabrication.

Web (stadium-edge) has **no** arbitrage page — this is mobile-only. api-server prop `ev`
fields were already real (no server change needed).

**"Find higher % arbs" is a feed-breadth lever, not a number knob.** Real guaranteed arbs
are inherently small (~0.5–2%); `MAX_ARB_PCT` is already 30 so nothing real is filtered for
being too high, and anything above ~3% is almost always a stale/voided line (NOT guaranteed —
rejecting it is honesty, not a bug). The ONLY legitimate way to surface more/higher arbs is to
scan more sportsbooks. odds.ts bulk game-line call now requests `regions=us,us2` (adds Fanatics,
ESPN BET, Hard Rock, Fliff, etc.) → more cross-book gaps. **Deliberately left the per-event
alt/period fetch at `regions=us`** to cap credit cost (per-event alt markets are 5x credit; us2
would double an already-expensive fan-out). If alt-line arb breadth is ever needed, that's the
next lever — with the credit-cost caveat. Restart api-server after odds.ts edits (no watcher).

Tests: `lib/arbitrage.test.ts` via `node --test 'lib/**/*.test.ts'` (96 total after +4).
