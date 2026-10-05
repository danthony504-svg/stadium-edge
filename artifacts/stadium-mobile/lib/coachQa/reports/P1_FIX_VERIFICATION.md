# P1 fix verification (RC1 / RC2 / RC4 / RC5)

## Before → After (same seed `6092026`)

| Metric | Before | After |
|---|---|---|
| Total tests | 13596 | 13596 |
| Passed | 13309 | **13566** |
| Failed | 287 | **30** |
| Warnings | 96 | 96 |
| P0 | 0 | 0 |
| P1 | 257 | **0** |
| P2 failures | 30 (RC3) | **30 (RC3 only)** |

### By root cause

| RC | Before | After |
|---|---|---|
| RC1 stale propsOnly | 169 | **0** |
| RC2 UFC/tennis legs | 56 | **0** |
| RC4 Chelsea / Ohio State | 24 | **0** |
| RC5 longest precedence | 8 | **0** |
| RC3 NCAAF gameLinesOnly (out of scope) | 30 | **30** (unchanged) |

## Screenshot sequence

`4 leg soccer` → `5 leg`: `propsOnly=false`, `path=full_board_mix`  
`5 player props`: `propsOnly=true` (current-request intent preserved)

## Files changed

Production:
- `artifacts/stadium-mobile/lib/slate.ts` — RC1
- `artifacts/stadium-mobile/lib/coach/parseAsk.ts` — RC2
- `artifacts/stadium-mobile/lib/coachAskTeamScope.ts` — RC4
- `artifacts/stadium-mobile/lib/explicitMarketLock.ts` — RC5
- `artifacts/api-server/src/lib/explicitMarketLock.ts` — RC5 twin sync

Tests / harness:
- `mentionsPropIntent.test.ts`, `parseAsk.test.ts`, `coachAskTeamScope.test.ts`, `explicitMarketLock.test.ts`
- `lib/coachQa/coachQa.harness.test.ts`, `runCoachQa.ts`

## Not changed

- RC3 college game-lines policy
- Thresholds / qualification / grading / simulation
- UFC/Tennis market availability
- Provider market keys
- Warnings policy (82+13+1 left alone)
- Merge / deploy / OTA / EAS
