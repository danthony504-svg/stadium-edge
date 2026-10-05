# Phase 2 Coach context cache — implementation + benchmarks

## What shipped
- Client TTL cache + in-flight coalescing for stable GETs (`coachContextCache.ts`), wired through `getJson`
- TTLs aligned to api-server: playerHistory 30m, injuries 10m, teamDefense 60m, matchupHistory 15m, teamPeriodStats 2h, gameSim 20m
- Game-outcome sim cache keyed by material fingerprint (**no American odds/price**)
- Live odds / props / simulate never cached
- Instrumentation: stage / calls / cacheHit / cacheMiss / coalesced / durationMs
- Coach QA: classification gate + optional live measure (`COACH_QA_RUN_PERF_MEASURE=1`)

## Benchmarks (production API)

| Run | Wall | HTTP calls | Cache hits | Notes |
|---|---:|---:|---:|---|
| Pre-Phase2 cold 5 leg | 42.0s | ~160 | 0 | baseline |
| Pre-Phase2 warm 5 leg | 27.7s | ~160 | 0 | baseline |
| **Phase2 cold 5 leg** | **29.7s** | 144 | 0 (+16 coalesced) | ≤30–35s target **met** |
| **Phase2 warm 5 leg** | **19.4s** | 31 | 129 | calls −81%; warm ≤10–15s **not yet** (remaining = live odds/props/sim) |
| soccer → 5 leg | 26.4s | — | partial | full-board after short soccer |
| 7 leg NFL (cold) | 12.9s | — | coalescing on history | |

## Quality / QA
- `pnpm test:coach-qa`: **13599/13599 PASS**, failed=0, warnings=96 (live-injection skips)
- P0/P1/P2 unexpected findings: **0**
- Ticket shape preserved: 5 legs with prop+GL mix; live books still drive EV

## Phone 6-minute audit
See `coach-phone-6min-lifecycle-audit.md` — delay is **not** backend-alone; device/network/JS-thread during full-board fan-out while UI sits on awaitingPropSlots.
