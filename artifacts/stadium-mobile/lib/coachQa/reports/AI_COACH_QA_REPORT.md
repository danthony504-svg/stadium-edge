# AI COACH QA REPORT

Generated: 2026-10-05T17:39:05Z  
Seed: `6092026`  
Harness: `artifacts/stadium-mobile/lib/coachQa/`  
Run: `pnpm --dir artifacts/stadium-mobile test:coach-qa`

## Summary

| Metric | Count |
|---|---|
| Total tests | **13596** |
| Passed | **13309** |
| Failed | **287** |
| Warnings | **96** |

### Severity

| Sev | Count | Meaning |
|---|---|---|
| P0 | **0** | crash / fabrication / wrong real line |
| P1 | **257** | violates explicit user request / materially wrong ticket routing |
| P2 | **43** | coverage / shortfall / skipped live injection |
| P3 | **1** | data-quality flag |

### By category (failed)

| Category | Failed | Notes |
|---|---|---|
| state_leak | 169 | `propsOnly` inheritance onto bare follow-ups |
| parser | 56 | mostly wording-variant leg expectations |
| date_sport_team | 34 | soccer/NCAAF exclusion nick gaps + lock family edge cases |
| market_coverage | 30 | NCAAF + market-family lock misses |
| failure_injection | 0 fail / 13 warn | live IO scenarios skipped offline |
| provider_integrity / mapping | 0 | fixture negatives pass offline |

## Confirmed production regression (screenshot)

Sequence:

1. `4 leg soccer`
2. `5 leg`

| Field | Clean `5 leg` | After `4 leg soccer` |
|---|---|---|
| requestedLegs | 5 | 5 |
| focalSports | [] | [] |
| propsOnly | **false** | **true** |
| allowedMarketKeys | null | null |
| isMarketLocked | false | false |
| path | **full_board_mix** | **props_only** |

**Root path:** `messagesRef` → `priorUserTexts` → `threadWantsPropsOnly` (`lib/slate.ts`) → `parseCoachAskMarketConstraint` (`lib/coachAskMarketFilter.ts`) → `buildCoachParlay` props-only + unlocked skill recovery copy (`lib/coach/buildParlay.ts` ~567: “locked-market props and … skill alts”).

**Not** a market-lock allowlist leak (`isMarketLocked` stays false). Wording says “locked-market” even when unlocked.

### Sequential matrix (must-reset)

| First → Second | Market lock reset | propsOnly reset | Notes |
|---|---|---|---|
| `5 leg touchdowns` → `5 leg` | PASS | PASS | allowlist does not inherit |
| `5 leg passing yards` → `5 leg` | PASS | PASS | |
| `5 leg sacks` → `5 leg` | PASS | PASS | |
| `4 leg soccer` → `5 leg` | PASS | **FAIL** | screenshot bug |
| `5 leg player props` → `5 leg` | PASS | **FAIL** | same inheritance |
| `6 leg NHL no Ducks` → `6 leg NHL` | PASS | n/a | exclusions do not inherit |
| brand-new session `5 leg` | — | PASS | generic mix |

## Top ranked issues (do not fix in this PR)

### P1 — stale `propsOnly` on bare follow-up (production affected)

- **Repro:** `4 leg soccer` → `5 leg` (also `7 leg player props` → `10 leg`, `9 leg nfl props` → `5 leg`, and sport-scoped N-leg priors via `wantsPropsOnly` soccer/mlb/nhl/nba rule)
- **Expected:** bare `N leg` → `propsOnly=false`, full-board mix
- **Actual:** `propsOnly=true` via `threadWantsPropsOnly`
- **Stage:** session priors / market constraint parse
- **Likely:** `lib/slate.ts#threadWantsPropsOnly`, `app/(tabs)/coach.tsx` priorUserTexts wiring
- **Count in suite:** 169

### P1 — team exclusion nick gaps

- **Repro:** `5 leg SOCCER no Chelsea`, `5 leg NCAAF no Ohio State`
- **Expected:** excludedTeams populated
- **Actual:** `excluded=[]`
- **Likely:** `lib/coachAskTeamScope.ts` nickname dictionary coverage
- **Count:** 24

### P1 — some wording variants leg mismatch

- **Count:** 56 (`give me N …` / compound templates vs expect.legs)
- Audit these before treating all as product bugs — some are harness expect strictness on free-form wording.

### P2 — NCAAF market-family lock coverage

- **Count:** 30 (`5 leg ncaaf <family>` failed to lock)
- Likely interaction of sport token + family regex precedence

### P2 — live failure-injection not executed

- Provider timeout/429, missing ESPN/history/injury/weather, sim timeout, partial board, cache miss/stale, etc. Documented as SKIP in offline run.

## Harness deliverables

| Path | Role |
|---|---|
| `lib/coachQa/matrix.ts` | request matrix + sequential seeds |
| `lib/coachQa/parseSnapshot.ts` | ask → structured snapshot |
| `lib/coachQa/invariants.ts` | parser + sequential invariants |
| `lib/coachQa/fuzz.ts` | ≥1000 seeded sequential + 500 parser fuzz |
| `lib/coachQa/fixtures.ts` | synthetic board + provenance rows |
| `lib/coachQa/pipelineAudit.ts` | ticket/provenance/mapping/coverage/perf/injection |
| `lib/coachQa/report.ts` | master report aggregation |
| `lib/coachQa/runCoachQa.ts` | runner |
| `lib/coachQa/coachQa.harness.test.ts` | node:test entry |
| `lib/coachQa/reports/coach-qa-report.md` | full markdown report |

**Not changed:** production Coach selection, thresholds, merge, Render, OTA, EAS.

**Not run in this default pass:** paid live 1000× provider calls (by design). Controlled live subset remains future work using `coachE2ERegisterHooks.mjs` + prod API.
