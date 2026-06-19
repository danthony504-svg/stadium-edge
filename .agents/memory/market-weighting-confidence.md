---
name: Market-weighting on pick confidence (mobile)
description: How/why mobile pick Confidence is tilted by a static market-priority prior + real historical hit-rate, and the honesty boundary it must keep.
---

# Market-weighting layer (mobile only)

`lib/marketWeighting.ts` adjusts ONLY `CombinedPickScore.confidencePct`, applied at the single chokepoint `attachPickScores()` (`lib/pickScoreContext.ts`, opt-in `perfByFamily`). Wired into coach.tsx (confidence-threshold filter + display) and game/[id].tsx AiGamePicks, each via a `useMemo(perfMapFromByFamily(computeAnalytics(results).byFamily), [results])`.

Two layers:
- STATIC prior (a stated user preference, NOT a data claim): boost rebounds/WNBA-props/defensive(blocks,steals)/spreads, reduce points/assists/totals/MLB-props; biases sum then clamp ±10. Buckets stack (WNBA rebounds = rebounds + wnba_props).
- DYNAMIC (REAL data only): per market family, gate decided ≥20; <40% → downgrade, >60% → upgrade. Magnitude fixed ±8. Total static+perf clamped ±15.

**Why Confidence and not Grade:** Grade is the pure value composite (signal-only) and stays untouched; Confidence is the metric the user referenced and the one Coach ranks/filters on. Keeps the two metrics from blurring.

**Honesty boundary (critical):** the layer only ADJUSTS a confidence the rubric already grounded from real signals. A null confidence (ungroundable leg) or null score is returned untouched — we NEVER manufacture a confidence from a market preference, and perf bias contributes nothing without a real ≥20 sample.

**Family-key join gotcha:** `familyKeyForPick` must match the GRADER's byFamily taxonomy (lowercase statText: "rebounds","total bases","home runs","spread","total","moneyline"...). Props derive it from `propMarketKey` (strip player_/batter_/pitcher_, `_`→space); game lines from `market`. If a new prop key's grader statText diverges from this normalization, its perf lookup silently no-ops (static still applies).

**Stale-closure trap:** coach.tsx `send` is a `useCallback`; `marketPerf` and `modelStrengths` (both `results`-derived) MUST be in its deps or a build runs on stale perf data. game/[id].tsx `load` likewise needs `marketPerf` in deps.

**Scope:** mobile-only (engine lives in stadium-mobile); web ParlayBuilder has no equivalent — web parity is a deferred gap. Pure module is db-import-free for `node --test` (`lib/marketWeighting.test.ts`).
