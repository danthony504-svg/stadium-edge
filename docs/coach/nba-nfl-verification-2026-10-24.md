# NBA/NFL verification — October 24, 2026

## Tested identities and limitations

Live backend health reported c277bea436c80aa4a3a9cabae9655f27df652d66. Latest successful production OTA workflow observed: run 40002521735, source 3ce210bfa317230c8750fa76810549cb6598c549. Latest successful preview: run 40039530710, source 41303fe7ad1fdc58cc300aa433e158ca9e4f5e9a. An update workflow is evidence of publication, not proof of the binary/update actually running on a subscriber device. Direct Expo manifest request returned HTTP 406. No OTA was published by this audit.

Six sequential two-leg requests used production mobile source 3ce210b with the existing Node test resolver against the real API. Native renderer, native version headers and Expo fetch were replaced by existing test shims; selected markets and simulations were real API/source pipeline operations. Crash/reliability reporting disabled; no Telegram/push test messages. These are source-pipeline probes, not signed-in iPhone acceptance tests. Later repeats used main's same mobile source plus the first mixed-routing change; they predate final composition/period guards.

| Initial request | Seconds | Returned | Timeout |
|---|---:|---:|---|
| NBA full-game ML/spreads | 11.513 | 0/2 | No |
| NBA player props | 4.675 | 2/2 | No |
| NBA explicit game-line/player-prop mix | 1.933 | 2/2, both props | No |
| NFL full-game ML/spreads | 41.004 | 0/2 | Yes |
| NFL player props | 11.852 | 2/2 | No |
| NFL explicit game-line/player-prop mix | 4.185 | 2/2, both props | No |

Props returned exact_market_10k evidence with event/athlete/market/side/line bindings, 10,000 draws, C+ or better and confidence >=52. Some NBA context factors were explicitly null, with only 38% contextual coverage; a passing qualification is not evidence of complete injuries/usage/opponent data or calibrated probabilities. Independent provider receipt-time/freshness and native card equality remain unverified.

Repeats: NBA mixed 13.256s (still two props after routing correction alone); NFL lines 42.138s and 41.014s (two picks but timeout flag); NFL mixed 41.705s (Q1 spreads before new guards). Repeats share API/module caches and are not isolated cold/warm benchmarks.

## Findings and prepared repairs

1. FAIL: generic explicit game-line/player-prop mix routed to props-only. Shared parser now distinguishes this from a mix of player props alone. Final and partial delivery also require both categories for an explicit mix, otherwise withhold the mixed ticket with an honest note. No qualification thresholds relaxed.
2. FAIL: NFL quarter spreads survived a mixed request. Common market filter and final/partial delivery now reject football quarter/half markets for NFL/NCAAF. Other sports' period handling unchanged.
3. FAIL: timed-out zero-result scan said no picks cleared quality despite incomplete scoring. Timeout shortfalls now explicitly state the scan was unfinished.
4. FAIL, unresolved: NFL game-line scans repeatedly exceeded the 15–30s target and reached scan deadline. Phase evidence: initial load1.513s, context7.708s, scan31.774s. Requires operation-level profiling and an optimization preserving simulations/qualification. No evidence supports claiming repaired speed.
5. Test-only stale assertion: production freeze test expected coach_exception for user cancellation, while implementation correctly emitted coach_cancelled; main already has corrected assertion. No cancellation production change needed for this finding.

## Evidence checklist

| Requirement | Result |
|---|---|
| Backend identity and health | PASS at audit |
| Subscriber device update identity | NOT VERIFIED; workflow source identified only |
| Six source-pipeline live requests | COMPLETED; failures above |
| Exact returned prop simulation identities, counts and floor fields | PASS for sampled props; not calibration proof |
| Full independent raw provider quote/freshness audit | NOT VERIFIED |
| Complete injury, usage, opponent and venue evidence | NOT VERIFIED; missing factors observed explicitly null |
| Qualification/scope/quote invariant tests | 112/112 production-source tests passed |
| Additional production-source tests | 81/82; stale cancellation assertion described above |
| Repair regression suite | 227/227 passed |
| NFL speed | FAIL, unresolved |
| Native rendering, cancel/retry, save/export, subscriber entitlement | NOT VERIFIED on device |
| Authentic settled probability accuracy/calibration | NOT VERIFIED; no immutable NBA/NFL forecast/outcome cohort audited |
| Release | NOT RELEASED; changes require mobile OTA and device verification |

Regression command from artifacts/stadium-mobile:

    node --import ./test/register-hooks.mjs --test lib/coachAskMarketFilter*.test.ts lib/boardScanPropDelivery.test.ts lib/sanitizeCoachUserNote.test.ts lib/coach/*.test.ts

Do not convert this checklist to all-pass based on a successful backend health check, simulated fixtures or a single winning/losing ticket.
