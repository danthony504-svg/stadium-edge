# Phase 2.4 Option C — correctness validation

**Status:** implemented + validated (no merge / deploy / OTA / build)

**PR:** #619 · branch `cursor/coach-phase24-dist-reuse-yield-def8`

## Canonical distribution key

```
fgDist|<outcomesRef|projectionSimRef>|<seriesKey>
```

| Part | Meaning |
|------|---------|
| `outcomesRef` | WeakMap identity of `{homeScores,awayScores}` (or projection-sim object when outcomes absent) |
| `seriesKey` | `ml\|home`, `ml\|away`, `spread\|home`, `spread\|away`, `total`, `teamTotal\|home`, `teamTotal\|away` |

**Material:** outcomes object identity + `kind` + `teamSide` (FG only; `period` must be `fg` / unset)

**Excluded (non-material to reusable series):** line / alt thresholds, `totalSide`, sportsbook / American odds / price, cover-query id

**Bypass (no FG series reuse):** halves / quarters / periods / race-to (`fgDistSeriesKey` → `null`)

### Identity proofs (unit)

| Case | Result |
|------|--------|
| same game/context + different spread threshold | reuse (`hits` +1) |
| same game/context + different total threshold | reuse |
| same game/context + different sportsbook/price | reuse dist; EV/edge recomputed from price |
| material context change (new outcomes object) | new distribution (`misses` +1 each) |
| period / race query | bypass; period cover still uses `periodScoresForDraw` / `raceToHits` |
| abort mid-yield | scan stops; prior series cache intact |

### Deterministic A≡C (seeded 10k fixture)

Shareable FG markets compared Mode A (fresh `distributionForQuery`) vs Mode C (`withFgDistSeriesReuse`):

- underlying reusable distribution (mean/median/stdev)
- cover hit probabilities (ML / spread / total / TT / ALT)
- EV / edge
- graded sim hit

**Numerical differences: none (expected delta 0).** Tests: `lib/gameSimDistReuse.test.ts` (10/10).

Yield proof: interleaved `setImmediate` between queries does not change rates, dist stats, draw count, or ordering.

## Changed files

| File | Class |
|------|-------|
| `artifacts/stadium-mobile/lib/gameSimDistReuse.ts` | **mobile** (shared client scoring lib) |
| `artifacts/stadium-mobile/lib/gameSimScoring.ts` | **mobile** |
| `artifacts/stadium-mobile/lib/boardMarketScanner.ts` | **mobile** |
| `artifacts/stadium-mobile/lib/gameSimDistReuse.test.ts` | **tests-only** |
| `artifacts/api-server/scripts/coachPhase24OptionCValidate.ts` | **tests-only** (harness) |
| `artifacts/api-server/scripts/coach-phase24-option-c-validate.md` | **tests-only** (this report) |

No **server** production path changes. No **shared** package changes.

## Deployment if approved

**OTA** (client-side board scoring / game-sim sanitize path).

Render: not required for this change set.  
Merge / deploy / publish OTA / build: **not done**.

## Regression table

| run | Coach wall | dist CPU | max loop delay | propSim | qualified | final |
|-----|------------|----------|----------------|---------|-----------|-------|
| fresh5 | 29153 | 143 | 2628 | 224 | — | 5 |
| repeat5 | 15835 | 6 | 4565 | 661 | — | 5 |
| soccer→5 | 29467 | 139 | 2643 | 204 | — | 5 |
| nfl7 | 12622 | 8 | 395 | 232 | — | **6** |

NFL 7→6 shortfall left separate — thresholds / fillers unchanged.

## 5× warm 5-leg

| run | Coach wall | dist CPU | max loop delay | propSim | qualified | final |
|-----|------------|----------|----------------|---------|-----------|-------|
| warm5-1 | 14682 | 0 | 4521 | 707 | — | 5 |
| warm5-2 | 15071 | 0 | 4516 | 707 | — | 5 |
| warm5-3 | 15390 | 0 | 4557 | 605 | — | 5 |
| warm5-4 | 15781 | 8 | 4576 | 1382 | — | 5 |
| warm5-5 | 14297 | 0 | 4549 | 1028 | — | 5 |

### Warm aggregates (min / median / mean / P95 / max)

| metric | min | median | mean | P95 | max |
|--------|-----|--------|------|-----|-----|
| Coach wall | 14297 | 15071 | 15044 | 15781 | 15781 |
| dist CPU | 0 | 0 | 2 | 8 | 8 |
| max loop delay | 4516 | 4549 | 4544 | 4576 | 4576 |
| propSim | 605 | 707 | 886 | 1382 | 1382 |

Warm `dist CPU ≈ 0` with `hits≈9925 / miss≈0` confirms series cache reuse across retained outcomes objects (game-sim HTTP cache).

## Gates

| Gate | Result |
|------|--------|
| Coach QA | **13599 / 13599 PASS**, failed **0**, warnings 96 |
| Unexpected P0 / P1 / P2 (harness) | **0** (13 offline live-injection skips remain `productionAffected: false`, same as Phase 2.3) |
| Case count retained | **13,599** |
| Phase 2.1–2.3 unit tests | **pass** (`propSimCtxCache`, `authoritativePlayerHistory`, `phase23HistoryEquivalence`, `athleteIdentityCache`) |
| Phase 2.4 reuse/yield + identity tests | **10 / 10 pass** |
| TypeScript new errors in Option C prod files | **0** (`gameSimDistReuse.ts` / `gameSimScoring.ts` clean; pre-existing `boardMarketScanner` / `node:test` noise unchanged) |
| #609 / #612 | intact (`coachAskTeamScope` + locked-market shortfall tests pass) |
| #341 abort / single-flight | abort checks preserved around yields; series cache not poisoned; game-sim inflight coalesce unchanged |
| #342 market-agnostic staging + NFL/NCAAF discovery | unchanged |
| NFL 7 shortfall | separate (6/7 observed; no threshold/filler changes) |

## Ancestry

`pr609` · `pr612` · `pr341` · `pr342` intent preserved.
