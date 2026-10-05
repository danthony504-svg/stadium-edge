# Phase 2.4 — simGame CPU Audit (findings only)

**Mode:** AUDIT ONLY — no production implementation, no Phase 2.1–2.3 cache/history/context changes, no merge/deploy/OTA/EAS.  
**NFL 7 shortfall:** out of scope (do not change qualification / filler).

**Artifacts:**
- `/opt/cursor/artifacts/coach-phase24-simgame-cpu-audit.json`
- Harness: `artifacts/api-server/scripts/coachPhase24SimGameCpuAudit.ts`

---

## Verdict

Warm Coach’s remaining ~16s event-loop starvation is dominated by **client-side outcome aggregation**, not by re-running 10k Monte Carlo draws.

| Hot function (warm CPU profile self) | ms | % of sim-related |
|--------------------------------------|---:|-----------------:|
| **`distributionForQuery`** | **9042** | **73.3%** |
| `coverQueryHits` | 1215 | 9.9% |
| `fgExpectedFromPeriodAverages` | 845 | 6.9% |
| `periodScoresForDraw` | 635 | 5.2% |
| `deriveCoverHitRatesFromOutcomes` | 515 | 4.2% |
| `sanitizeGameSimHit` | 56 | 0.5% |
| `scoreGameLinePick` | 20 | 0.2% |

Call chain:

```text
scoreGamesAndMaybePartial
  → evaluateGameLines / gameSimHitForPick
    → sanitizeGameSimHit   # always
      → distributionForQuery(outcomes[10k])  # walk + sort EVERY pick
    → (miss path) deriveCoverHitRatesFromOutcomes / coverQueryHits
```

`sanitizeGameSimHit` calls `distributionForQuery` even when `coverHitRates[query.id]` is already present. That is the primary warm-path CPU.

Server `runGameMonteCarlo` (one 10k draw) is cheap in isolation (~12–25ms/game in microbench).

---

## Per-game / batch table (cold full-board intercept)

Outer `SLATE_SIM_BATCH=4`, inner `SLATE_SIM_CONCURRENCY=4`.

| metric | value |
|--------|------:|
| games (canonical) | **22** |
| HTTP game-sim calls | **22** |
| unique fingerprints | **22** |
| duplicate canonical games in-scan | **0** |
| simulations/game | **10_000** |
| total simulations requested | **220_000** |
| cover queries/game | **6–169** (MLB dense alts) |
| max event-loop delay (cold) | **1674ms** |
| propSim wall (cold) | **194ms** |

Sample rows (cold):

| game | sims | covers | HTTP wall | HTTP cpu |
|------|-----:|-------:|----------:|---------:|
| TB Rays @ NYY | 10000 | 169 | 380 | 95 |
| SD @ MIL | 10000 | 165 | 530 | 94 |
| NO Saints @ ATL (NFL) | 10000 | 10 | 605 | 183 |
| … | 10000 | … | … | … |

**Within one slate pass:** 10k is performed **once per unique game** and cover queries for all markets on that game ride the same request/draw set.

---

## Reuse vs redo (canonical identity)

### Already true (by design)

Server comment in `gameMonteCarlo.ts`: one 10k draw powers ML / spread / total / team totals.  
Client `fetchSlateGameSimulationsWithStatus` builds **all** `coverQueries` from eval lines, then one `fetchGameOutcomeSimulation` per game.

Period markets: re-derived from retained `outcomes` + period offense/defense profile (`deriveCoverHitRatesFromOutcomes`) — not a second 10k engine run.

### Duplicate risk (fingerprint)

`fingerprintCoachGameSim` includes **sorted coverQueries (lines/markets)**.

Material MC inputs (team IDs, sport, form, weather, N=10000) do **not** depend on cover lines. Cover lines are post-draw scoring.

**Consequence:** same canonical game with a different alt-line set → different fingerprint → another 10k HTTP/MC even though draws are identical in material context.

Warm scan still showed gameSimulation cache **15H / 29M** and 7 HTTP calls — consistent with fingerprint churn / slate membership drift, not “one game scored 20 independent 10ks inside one batch.”

### Warm path (cache hit)

Even with 0 new draws, grading still pays `distributionForQuery` × (every game-line pick × every partial score pass) over 10k outcomes → multi-second sync turns → **propSim starved** (warm propSim wall **9742ms**, max loop delay **8529ms**).

---

## Full-board benchmark (exact harness workload: `5 leg`)

| version | Coach wall | sim-related CPU (self) | max event-loop delay | propSim wall | final legs |
|---------|-----------:|-----------------------:|---------------------:|-------------:|-----------:|
| cold_current | 19054 | 2281 | 1674 | **194** | 5 |
| warm_current | 25505 | **12328** | **8529** | **9742** | 5 |
| warm_http_shortcircuit | 21955 | ~13k (same local scoring) | **16891** | **15911** | 5 |

Success metric (from brief): propSim should stay ~ms while game work runs. **Current warm fails that** — propSim appears ~10–16s because the event loop is blocked in `distributionForQuery` / cover helpers.

---

## Priority proposal: reuse, not weaker sims

**Do not reduce 10_000.** Preserve live provider lines/odds as authoritative.

### 1) One distribution per canonical game + material context

Fingerprint / cache key material fields only:

- `sport | homeTeamId | awayTeamId | homeTeam | awayTeam | simulations`
- plus server-side form/injury/weather inputs already baked into the draw

**Exclude** cover query lines/markets from the identity (odds already excluded).

Reuse that single 10k outcome set for:

- moneyline  
- spread / alt spread  
- total / alt total  
- team totals  
- periods/halves/quarters **only** where existing period profile + `deriveCoverHitRatesFromOutcomes` already supports them  

Do **not** reuse across materially different simulation inputs (different team form, weather, N, or sport engine).

### 2) Stop re-aggregating 10k per pick

Once per `(gameIdentity, query.id)` (or once per unique query on a sim entry):

- keep server `coverHitRates`  
- compute/cache `{mean, median, stdev}` once  
- `sanitizeGameSimHit` reads cache — **no** full walk/sort per pick  

Scaled microbench (648 pick-evals, 54 unique queries, N=10k):

| approach | wall | prop-like promise latency | max loop delay |
|----------|-----:|--------------------------:|---------------:|
| current (dist per pick-eval) | 530ms | **533ms** (starved) | 528ms |
| dist once per unique query | 51ms | — | — |
| deriveCoverHitRates once for all queries | 27ms | — | — |

Amplification vs once-per-unique: **~10×** at this scale; production warm profiles imply still higher call multiplicity (partials / dense MLB alts).

---

## If CPU remains inherently blocking — option audit

### 1) Cooperative yielding / chunking

| chunk (pick-evals between `setImmediate`) | wall | prop latency | max loop delay |
|------------------------------------------:|-----:|-------------:|---------------:|
| 1 | 532 | **2** | 1 |
| 5 | 527 | **6** | 5 |
| 10 | 527 | 14 | 5 |
| 25 | 527 | 40 | 18 |
| 50 | 526 | 80 | 36 |
| 100 | 526 | 160 | 77 |
| (no yield / blocking) | 530 | 533 | 528 |

- Restores propSim responsiveness without changing math if chunk boundaries do not reorder RNG (aggregation-only path has **no RNG**).  
- Seeded MC draw generation (if moved client-side) must yield between draws **without consuming extra randoms**.  
- Best paired with reuse (#2 above) so total CPU also drops.

### 2) Worker thread / pool

| | main sync | worker |
|--|----------:|-------:|
| wall (42 queries micro) | 13ms | 56ms (startup+serialize) |
| main CPU during | 15ms | 82ms (copy) |
| payload ~10k×2 floats + queries | — | ~160KB |

- **Render Node API:** `worker_threads` OK.  
- **Expo/RN client (where this CPU runs today):** no `worker_threads`; would need `InteractionManager` chunking or **move grading to server**.  
- Serialization of full outcome arrays is non-trivial; prefer computing stats once on server or caching after first main-thread pass.

### 3) Server-side precomputation / cache

Already returns `coverHitRates` + optional `outcomes`. Gap: client still rebuilds distributions for integrity/grade metadata.

Safest next server addition (audit recommendation only): attach per-query `{mean,median,stdev}` next to `coverHitRates` for the same draw set — identical numbers, no second MC, client skips `distributionForQuery`.

---

## Dual concurrent Coach

Two parallel `buildCoachParlay` calls (no shared `requestId`):

| | wall | propSim | game HTTP |
|--|-----:|--------:|----------:|
| A | 19641 | 8486 | 8 |
| B | 21261 | 8486 | 8 |
| parallel span | 21299 | — | — |
| max loop delay | **9255** | | |

Both complete with 5 legs. Contention here is shared event-loop CPU, not duplicate scan join.

**PR #341 note:** `coachBoardScanGuard.ts` (single-flight per `requestId` + abort) is **not present on this branch**; current equivalent is `AbortController` / `abortRef` in `coach.tsx` plus fingerprint-level `gameSimInflight` coalesce. Any future work must preserve that single-flight/abort intent — do not reintroduce duplicate scans.

---

## Correctness bar (for any future implementation)

Any change must keep identical outputs for the same retained draw set + cover queries:

game probs · expected scores/distributions · ML/spread/total probs · qualification · EV/edge · grade/confidence · candidate ordering · correlation/diversity · final ticket  

No approximation, no lower N.

**RNG reality (explore confirmation):**
- Server/client **game** MC uses **`Math.random()` only** — no seed API today (unlike prop MC’s optional Mulberry32).
- `distributionForQuery` (the warm hot path) is **pure aggregation** — no RNG; caching it is bit-identical for a fixed `outcomes` array.
- Period re-derive (`periodScoresForDraw` / race-to) injects **`Math.random()` noise per draw**, so period cover rates are not reproducible from FG outcomes alone even when FG draws are held fixed. Do not “stabilize” that by accident when chunking; FG aggregation reuse is the safe first cut.

---

## What not to do in Phase 2.4 implementation (when it starts)

- Do not touch Phase 2.1–2.3 propsim-ctx / history / dist caches as the fix  
- Do not reduce 10k  
- Do not change NFL7 qualification / filler  
- Do not “weaken” sims across material contexts  

**First implementation priority when allowed:** reuse identity (drop cover lines from fingerprint) + eliminate per-pick `distributionForQuery` walks; then add cooperative yields around remaining sync scoring so propSim stays milliseconds.
