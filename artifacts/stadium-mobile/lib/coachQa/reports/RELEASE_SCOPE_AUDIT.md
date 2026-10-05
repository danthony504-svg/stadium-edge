# Release-scope audit — RC1–RC5 Coach QA fixes

**PR:** #612  
**Branch:** `cursor/coach-rc3-college-lock-def8`  
**HEAD:** `e4291b35497070e6ad03db02bfb85ef0319e11d5`  
**Base:** `main`  
**Gate:** 13,596 / 13,596 PASS · Failed 0 · P0–P2 0 · RC1–RC5 0 · Warnings 96 unchanged

## Production files (7)

| File | RCs | Runtime |
|---|---|---|
| `artifacts/stadium-mobile/lib/slate.ts` | RC1 | Mobile/Expo |
| `artifacts/stadium-mobile/lib/coach/parseAsk.ts` | RC2 | Mobile/Expo |
| `artifacts/stadium-mobile/lib/coachAskTeamScope.ts` | RC4 | Mobile/Expo |
| `artifacts/stadium-mobile/lib/explicitMarketLock.ts` | RC5 | Mobile/Expo |
| `artifacts/api-server/src/lib/explicitMarketLock.ts` | RC5 | Render/server (`chat.ts`) |
| `artifacts/stadium-mobile/lib/boardScanPropDelivery.ts` | RC3 | Mobile/Expo |
| `artifacts/stadium-mobile/lib/coachAskMarketFilter.ts` | RC3 | Mobile/Expo |

**Execution summary:** mostly **mobile/Expo** Coach parse + board-scan path; **both** for RC5 (`explicitMarketLock` twin kept identical for server chat).

## Test / harness files

- `lib/coachQa/**` (permanent suite: matrix, fuzz, invariants, pipeline, runner, reports)
- `package.json` → `test:coach-qa`
- `.gitignore` → generated `*.jsonl` / `coach-qa-report.json`
- Focused tests: `mentionsPropIntent.test.ts`, `parseAsk.test.ts`, `coachAskTeamScope.test.ts`, `explicitMarketLock.test.ts`, `coachAskMarketFilter.test.ts`, `boardScanPropDelivery.test.ts`

## Scope confirmations

| Check | Status |
|---|---|
| No quality/EV/grade/confidence threshold changes | Confirmed (diff grep clean) |
| No simulation-count / model changes | Confirmed |
| No provider lines/odds modified | Confirmed |
| PR #609 entire-matchup exclusions intact | Confirmed (19/19 team-scope tests pass) |
| No subscription / RevenueCat / StoreKit | Confirmed |
| No native / iOS / Android / app.json / eas.json | Confirmed |
| No unrelated UI changes | Confirmed (no `coach.tsx` / screen diffs) |
| 13,596-test harness retained permanently | Confirmed (`lib/coachQa` + `pnpm test:coach-qa`) |

## TypeScript

- No new errors in RC1/RC2/RC4/RC5 source (`slate`, `parseAsk`, `coachAskTeamScope`, `explicitMarketLock`, `coachAskMarketFilter`).
- `boardScanPropDelivery.ts` still has pre-existing `CorrelationPick` generic assignability noise (untouched by RC3 logic hunks).
- Broader package `tsc` still has pre-existing `node:test` typing noise in `*.test.ts`.

## Not done

Merge · deploy · OTA · EAS build.
