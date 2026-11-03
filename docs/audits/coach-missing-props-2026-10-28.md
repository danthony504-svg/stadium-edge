# Coach missing player props — October 28, 2026

Production device trace: 8:40 AM CDT build `greenfield-1793194739620`, preview update `01a182b3-19c3-7f12-883c-8f57d6df4140`, 7/7 game lines, 71,390 ms. Source: read-only reliability record. No identity or secrets included.

## Confirmed causes and fixes

1. **Early terminal race.** Main had not incorporated PR #955. The live production-selection replay emitted seven game-only provisional seats while prop slots were pending. The actual phone terminal helpers accepted them and cancelled remaining work. Preserve qualified game-only partials below the target until props are done. Final all-game tickets remain permitted when no props qualify; explicit game-line asks remain unchanged.
2. **Cross-sport defense starvation.** The 24-team loader sorted a whole NFL schedule before other leagues. With a full NFL slate it spent the evidence cap before current NBA/WNBA/NHL/MLB posted-prop opponents. Required evidence gates correctly withheld those props. Prioritize sport+game-bound posted-prop matchups and interleave leagues within the same cap and concurrency. Regression uses the real loader with a 16-game NFL fixture plus posted NBA/WNBA/NHL/MLB games.
3. **Empty evidence cached for an hour.** The shared client cache retained cold, empty opponent-market arrays under the normal 60-minute defense TTL. Live WNBA/MLB requests initially received zero markets; later direct checks returned 10/7 markets and subsequent replays delivered props. Source verification confirms the long empty-cache retention. Empty/insufficient arrays now expire in 5 seconds; completed evidence retains normal TTL and in-flight coalescing. No extra foreground retry or invented data.
4. **Rate-limit cascade.** The pending-only replay continued through 120 HTTP 429 prop-simulation responses after the shared server simulation bucket was exhausted. Subsequent failures entered unapproved historical fallback and gave no seatable simulation. Honor shared route cooldown, stop later prop waves, skip fallback after known rate limiting and retain an explicit `simulation_rate_limited` reason. Server limits and quality requirements are unchanged.
5. **Misleading empty/short diagnostics.** Missing opponent evidence was overwritten by generic not-simulated/odds wording; final exposure filtering could leave two cards beside a note claiming four. Preserve the evidence reason and report final delivered counts after player/event/exposure checks. These changes do not loosen limits.

## Live-data results

Node uses the production builder, simulation, qualification, and phone terminal helpers via the existing native UI resolver. No mocked odds, prop simulation, history, or defense responses. Reliability/learning outbound POSTs are suppressed. Local audit storage and UI rendering are not native-device measurements. Early phone success intentionally cancels the remaining builder; an AbortError after that latch is expected, not a failed delivered ticket.

| Run | Ask | Delivered legs | Player props | Seconds |
| --- | --- | ---: | ---: | ---: |
| baseline | 7 leg | 7 | 0 | 30.3 |
| fixed | 7 leg | 7 | 0 | 65.5 |
| rootfix | 7 leg | 7 | 4 | 36.4 |
| finalmixed | 7 leg | 7 | 4 | 41.9 |
| nba | 7 leg NBA player props | 5 | 5 | 20.5 |
| wnba | 7 leg WNBA player props | 0 | 0 | 10.0 |
| wnba-recheck | 7 leg WNBA player props | 2 | 2 | 8.9 |
| nhl | 7 leg NHL player props | 2 | 2 | 20.7 |
| mlb | 7 leg MLB player props | 0 | 0 | 9.7 |
| mlb-recheck | 7 leg MLB player props | 2 | 2 | 13.3 |
| nflfinal | 7 leg NFL player props | 2 | 2 | 17.7 |

The initial WNBA/MLB zeroes were unavailable opponent evidence, not evidence that all those props failed odds. Once evidence was present, each returned two valid props. Five-, two- and other short tickets reflect qualification and exposure caps; seven props were not forced. Audit counts represent quote/selection observations, not distinct players or games.

Mixed replays restored four props using seven successful simulation POSTs in the first corrected replay, versus zero props and a rate-limit cascade before all fixes. Speed is still above the 15–30 second target for mixed scans (36–42 seconds in these Node runs); no iPhone timing claim is made.

## Validation

- 45 focused regressions pass (pending completion, defense slot coverage, cache expiry, actual HTTP 429 follow-up suppression, audit and terminal reasons).
- Full critical reliability script passes; mobile TypeScript passes; diff whitespace passes.
- Shared team-sport behavior; no NCAAF/NCAAB validation unlock, quality-floor reduction, model approval, backend deploy, OTA, Telegram or push.
- Manual replay: from `artifacts/stadium-mobile`, run `EXPO_PUBLIC_DOMAIN=stadium-edge.onrender.com node --import ./test/register-hooks.mjs scripts/audit-coach-prop-delivery.mjs '7 leg' audit`.

## Release limitation

The code fix is verified in the harness; the subscriber iPhone still needs the reviewed preview build and device verification. No app update was published for this investigation.
