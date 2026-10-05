# RC3 fix verification

## Root cause

College automatic board-mode default discarded explicit market locks:

1. `askIsCollegeFootballOnly(ask)` true for `ncaaf` / `college` / `cfb`
2. `askAllowsNcaafPlayerProps` only recognized yards / TDs / sacks / receptions / “player props”
3. `wantsGameLinesOnlyAsk` → `gameLinesOnly=true` for those asks
4. `parseCoachAskMarketConstraint` required `explicit && !gameLinesOnly`, so
   `matchExplicitMarketLocks` results were thrown away (`allowedMarketKeys=null`)

Example: `5 leg ncaaf completions` matched `fb_completions` then returned bare college game-lines-only.

## Fix

Explicit named market intent beats the automatic college default:

- `askAllowsNcaafPlayerProps`: any `matchExplicitMarketLocks` hit is opt-in
- `parseCoachAskMarketConstraint`: return the explicit lock even when college default would set `gameLinesOnly`

Preserved: bare `8 leg college` / NCAAF / Collage → gameLinesOnly; dates; team include/exclude; #609 matchup exclusions; real provider keys only; thresholds.

## Files changed

- `artifacts/stadium-mobile/lib/boardScanPropDelivery.ts`
- `artifacts/stadium-mobile/lib/coachAskMarketFilter.ts`
- `artifacts/stadium-mobile/lib/coachAskMarketFilter.test.ts` (all 30 RC3 cases + variants)
- `artifacts/stadium-mobile/lib/boardScanPropDelivery.test.ts`
- `artifacts/stadium-mobile/lib/coachQa/coachQa.harness.test.ts`

## Results (seed `6092026`)

| Metric | Before RC3 fix | After |
|---|---|---|
| Tests | 13596 | 13596 |
| Passed | 13566 | **13596** |
| Failed | 30 | **0** |
| Warnings | 96 | 96 |
| P0 / P1 / P2 | 0 / 0 / 30 | **0 / 0 / 0** |

| RC | Count |
|---|---|
| RC1–RC5 | **0** |

RC1 sequential: `4 leg soccer → 5 leg` still `propsOnly=false`.
