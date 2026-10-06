# Phase 2.1–2.4 final validation

**Branch:** `cursor/coach-phase24-dist-reuse-yield-def8` · **PR:** #619  
**No merge / deploy / OTA / build. No further performance optimization in this PR.**

---

## A≡C deterministic equivalence (shareable FG)

Seeded 10k fixture · Mode A = fresh `distributionForQuery` · Mode C = `withFgDistSeriesReuse`.

| Field | A vs C delta |
|-------|----------------|
| raw reusable distribution (mean/median/stdev) | **0** |
| ML probabilities | **0** |
| spread probabilities | **0** |
| total probabilities | **0** |
| team-total probabilities | **0** |
| compatible ALT probabilities | **0** |
| EV / edge | **0** |
| grade / confidence | **0** (identical inputs → identical; simHit sanitize uses A≡C dist) |
| qualification | **0** |
| ordering | **0** |
| correlation / diversity breakdown | **0** |
| final ticket | **0** |

Tests: `lib/gameSimDistReuse.test.ts` — **12 / 12 PASS** (includes staging ticket identity).

Canonical key: `fgDist|<outcomesRef|projectionSimRef>|<seriesKey>`  
Series keys: `ml|home|away`, `spread|home|away`, `total`, `teamTotal|home|away`.  
Excluded: line, totalSide, sportsbook/price.

## Period / race-to paths

**Unchanged.** Option C commit does not modify `gamePeriodScoring.ts` or `coverQueryHits` / `periodScoresForDraw` / `raceToHits` bodies.  
`fgDistSeriesKey` returns `null` for `period !== "fg"` and `raceTo` — those markets bypass FG series reuse and keep existing `Math.random` stochastic helpers.

## 5× warm 5-leg

| run | Coach wall | max loop delay | propSim | dist CPU | qualified | final |
|-----|------------|----------------|---------|----------|-----------|-------|
| warm5-1 | 14840 | 4628 | 678 | 0 | 118 | 5 |
| warm5-2 | 15183 | 4595 | 571 | 0 | 118 | 5 |
| warm5-3 | 14915 | 4571 | 828 | 0 | 118 | 5 |
| warm5-4 | 14975 | 4545 | 600 | 7 | 118 | 5 |
| warm5-5 | 16175 | 4570 | 1564 | 8 | 121 | 5 |

### Aggregates (min / median / mean / P95 / max)

| metric | min | median | mean | P95 | max |
|--------|-----|--------|------|-----|-----|
| Coach wall | 14840 | 14975 | 15218 | 16175 | 16175 |
| max loop delay | 4545 | 4571 | 4582 | 4628 | 4628 |
| propSim | 571 | 678 | 848 | 1564 | 1564 |
| dist CPU | 0 | 0 | 3 | 8 | 8 |

## NFL 7→6 (separate diagnosis — no threshold/filler changes)

```
requested     → 7
available     → propPool=916, oddsGames=1, gameEntries=1
simulated     → gameSims=1, gameLegsScored=808, propSimEval=35, propLegsScored=7
qualified     → scoredBeforeStage=23
correlation/diversity staging → per-game / prop-mix / diversity caps
staged/final  → 6
```

All 6 final legs are **ATL @ NO** (only NFL game on slate).  
**Legitimate 7th qualified candidate existed:** **YES** (`scoredBeforeStage=23 ≥ 7`).  
Disappearance point: **staging_correlation_diversity_or_per_game_cap** — not empty board, not sim failure. Do not lower thresholds or add filler.

## Regression gates

| Gate | Result |
|------|--------|
| Coach QA | **13599 / 13599 PASS**, failed **0**, unexpected P0/P1/P2 = **0** |
| QA case count vs 13,596 | **13,599 = 13,596 + 3** intentional Phase-2 hang/terminal regression cases (retained; not deleted). Phase 2.3/2.4 did not alter the count. |
| Phase 2.1–2.3 unit tests | **PASS** (propsim-ctx, auth history, hist equivalence, athlete identity) |
| Phase 2.4 reuse/yield/identity/A≡C | **12 / 12 PASS** |
| TypeScript new errors (Option C prod) | **0** |
| #609 / #612 | intact |
| #341 abort / single-flight | intact (abort around yields; cache not poisoned; game-sim inflight unchanged) |
| #342 staging + NFL/NCAAF discovery | intact |

## Changed production files

| File | Class |
|------|-------|
| `artifacts/stadium-mobile/lib/gameSimDistReuse.ts` | **mobile** |
| `artifacts/stadium-mobile/lib/gameSimScoring.ts` | **mobile** |
| `artifacts/stadium-mobile/lib/boardMarketScanner.ts` | **mobile** |
| `artifacts/stadium-mobile/lib/gameSimDistReuse.test.ts` | **tests-only** |
| `artifacts/api-server/scripts/coachPhase24OptionCValidate.ts` | **tests-only** |
| `artifacts/api-server/scripts/coachPhase24FinalValidate.ts` | **tests-only** |
| `artifacts/api-server/scripts/coach-phase24-*.{md,json}` | **tests-only** |

**server:** none · **shared:** none

## Deployment if approved

**OTA** (client board scoring / sanitize path). Render not required.

## MERGE READY

**YES**

Reasons:
1. A≡C delta 0 across dist → probs → EV/edge → grade/confidence → qualify → order → correlation → ticket.
2. Period/race stochastic paths untouched.
3. All listed regression gates pass; case count explained (13596+3).
4. No further perf work in this PR; NFL 7→6 diagnosed separately with a real 7th qualified candidate blocked by staging policy on a 1-game NFL slate.
5. Production blast radius is mobile-only → OTA.
