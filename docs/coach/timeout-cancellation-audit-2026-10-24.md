# Coach timeout audit — 2026-10-24

Base: main `4f52a8a755d3ce9501e3176797954d7574d6eeba` (merged #915).

## Fixed paths

- Whole-build settlement guard shares the original start/deadline across load, context, props-only, recovery, scan and finalization. Ignored aborts cannot hold the foreground promise indefinitely. Only revalidated buffered picks can be returned on timeout; late status/partial callbacks are fenced.
- GET headers/body/retries/backoff share one timeout, rather than restarting the timer for each part. Simulation POST bodies are covered by cancellation and deadline too.
- Cancelled simulation queue waiters are removed immediately; stale queued requests never start after cancellation.
- Scanner deep-prop batches and enrichment abort their owned work on timeout, clear timers and settle immediately on parent cancellation.
- Props-only history prefetch shares one 8-second window across waves (previously up to six sequential 14-second waves). Completed current-season history remains available when prior-season backfill stalls. Missing histories remain unknown; quality floors remain enforced.
- Props-only deep batches settle on parent cancellation even if transport ignores abort. Recovery cannot start after the absolute deadline.
- Removed the 2.5-second drain fallback that added time when remaining budget was zero. Pool expansion no longer waits another 25 seconds after cancellation.
- Timeout explanation survives final delivery filtering and the UI absolute-terminal flush. An unfinished scan does not establish an exhausted board.
- Unambiguous named-team reliability alerts resolve their sport (Saints -> NFL); ambiguous names remain unspecified.
- Addressed #915 raw-game prefilter review finding: provider game rows do not have player propMarketKey; preserve soccer rows at pre-simulation filtering while retaining request/period exclusions and final delivery constraints.

No simulation-count, 52% confidence/C+ quality-floor, NCAAF validation-gate or subscription changes. Existing request caps (including 90 seconds for six legs) are unchanged; this is not a guaranteed 30-second SLA.

## Validation

245 primary Coach/deadline/HTTP/queue/filter/period tests passed; 79 related props-only/reliability/context/cooldown tests passed. Mobile TypeScript check and git diff whitespace check passed. Tests include a real build whose loading ignores cancellation, exhausted-start no-work behavior, hung response-body cancellation, queued cancellation, and late rejection handling.

## Live source smoke checks

Revised local mobile source against production APIs, sequential requests, reliability/crash reporting disabled. This is not subscriber iPhone or post-OTA proof, and not a controlled benchmark against the previous version. All seven completed without timeout. Odds/data availability and shared caches affect results.

| Ask | Seconds | Returned | Outcome |
| --- | ---: | ---: | --- |
| 6 leg New Orleans Saints | 8.191 | 5 | Only 5 eligible real-market selections for Saints — not enough for a 6-leg ticket. Won't fill with other games. |
| 2 leg NBA spreads and moneylines only | 5.404 | 0 | You asked for 2 legs — no AI-backed picks cleared the quality bar. No ungraded filler was added. |
| 2 leg NBA player props only | 2.102 | 0 | No NBA props loaded; incomplete availability coverage |
| 2 leg NBA mixing a game line and a player prop | 0.936 | 0 | No NBA props loaded; incomplete availability coverage |
| 2 leg NFL spreads and moneylines only | 15.025 | 2 | Full ticket |
| 2 leg NFL player props only | 14.062 | 2 | Full ticket |
| 2 leg NFL mixing a game line and a player prop | 7.974 | 0 | The requested game-line/player-prop mix did not produce qualifying picks from both categories. No mixed ticket was built. |

## Still unverified / release conditions

- Production Render logs: no workspace selected; connector explicitly requires user selection before reading service logs. No workspace selected or service changed.
- Exact mapping of phone OTA `01a16b16-c2e6-7b75-b534-b068cc7d68f0` to source commit remains unverified. It was not present in repository text.
- No native build, merge, production deployment or OTA publication performed.
- Repeat device cold-launch, exact update identity, six-leg Saints run, cancellation/retry and NBA props/mix when a posted board is available.
- The 96–98% card probabilities and 32.9s/138.5s screenshots require their own provenance/device inspection; no accuracy or timer-fix claim is made from this timeout sweep.
