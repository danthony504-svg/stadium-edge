# Phase 2.3 — Warm `runPropSims` ~13.2s Phase Audit (findings only)

**Mode:** AUDIT ONLY — no production optimizations, no mapping/TTL/sim/threshold/grade/ALT/correlation changes, no merge/deploy/OTA/build.

**Artifacts:**
- `/opt/cursor/artifacts/coach-phase23-propsim-phase-audit.json`
- `/opt/cursor/artifacts/coach-phase23-c3-drain.cpuprofile`
- Audit harness (not production): `artifacts/api-server/scripts/coachPhase23PropSimPhaseAudit.ts`, `propSimRunnerPhaseAudit.ts`

---

## Verdict

The warm-path **~13–16s “server compute” attributed to `runPropSims` is not prop-sim work.**

It is **concurrent Coach local game-line Monte Carlo scoring** (`distributionForQuery` / `coverQueryHits` / `simGame`) that runs on the same Node event loop while `runPropSims` is awaiting. That CPU is mis-counted into:

- `propSimElapsedMs` / phase wall for `2_context_lookup_build`
- `process.cpuUsage()` across those awaits

Isolated warm `runPropSims` with the same payload and cache shape is **~13–14ms**.

---

## MLB runs/RBIs (tracked separately — not the 13s)

| Item | Detail |
|------|--------|
| Misses | 4 sticky `stat_mapping_failed` — Aranda/Hicks × `batter_runs` / `batter_rbis` |
| Cost | ~0ms when history is local; no ctx cache write |
| Action | **Do not change mappings as a perf fix.** Track as correctness/coverage only. |

---

## A / B / C comparison (warm, ctx 17H/4M, dist 17H/0M, generated 0)

| Mode | propSim wall | CPU | Notes |
|------|-------------:|----:|-------|
| **A** isolated `runPropSims` | **~13–14ms** | ~14ms | Same payload, no Coach |
| **B** `/simulate/props` path alone | **~13ms** | ~13ms | Athlete resolve + injuries + propSim, no Coach |
| **C** full-board Coach scan | **~15.7–16.0s** | ~16.1s | Almost all in `2_context_lookup_build` |
| **C2** Coach + game-sim **HTTP** short-circuit | **~15.8–16.0s** | ~16.0s | Still slow — local `simGame` still runs |
| **C3** drain event loop until quiet, **then** propSim | drain **~15.7–17.1s** CPU → propSim **~20–29ms** | drain ~17s / prop ~0.1s | Proves misattribution |

**Interpretation:** `C_13s_IS_CONCURRENT_COACH_CPU_MISATTRIBUTED_drain_absorbed_13s_then_propSim_fast`

---

## Phase breakdown inside warm C (`runPropSims` wall ≈ 15971ms)

Reconciled phases (subset/nested rows excluded from sum):

| phase | count | start | end | exclusive wall | CPU user+sys |
|-------|------:|------:|----:|---------------:|-------------:|
| 1_input_normalization_grouping | 1 | 0 | 0 | 0 | 0 |
| **2_context_lookup_build** | 1 | 0 | 15958 | **15958** | **16081** |
| 3_history_fingerprint (subset) | 1 | 0 | 15958 | 0 | 0 |
| 4_distribution_key_construction | 1 | 15958 | 15971 | 0 | 0 |
| 5_distribution_cache_lookup | 1 | 15958 | 15971 | 0 | 0 |
| 7_threshold_probability_evaluation | 1 | 15958 | 15971 | 12 | 0 |
| 8_alt_expansion | 1 | 15958 | 15971 | 0 | 0 |
| 13_row_assign | 1 | 15958 | 15971 | 0 | 0 |
| 5_7_8_dist_loop_wall | 1 | 15958 | 15971 | 13 | 13 |
| 13b_phase23_enrich_history_payload | 1 | 15971 | 15971 | 0 | 0 |
| 9–12 fair/EV/grade/sort | — | — | — | 0 | outside propSim (Coach) |

**Occupancy split for phase 2 (sums to phase wall):**

| | ms |
|--|---:|
| contextPhaseSyncMs (awaitDepth=0) | ~5967 |
| contextPhaseAwaitMs (≥1 worker awaiting) | ~9991 |
| contextPhaseCpuMs (`process.cpuUsage` over phase wall) | ~16081 |
| unexplained (reconciled phase sum vs total) | **~0** |

True prop-sim work after the misattributed window: dist lookup + threshold eval **~13ms** (matches A/B).

---

## Per-group timing (C — sorted by total; **queue-wait inflated**)

There are ~21 groups / ~17 dist hits. Group `ctxMs`/`totalMs` include **parallel worker wait** while Coach occupies the event loop — **do not treat as exclusive prop-sim cost**. Per-group `syncMs` ≈ 0.

| group | player | stat | lines | ctx ms | fp ms | dist lookup | threshold | total | ctxHit | distHit |
|------:|--------|------|------:|-------:|------:|------------:|----------:|------:|:------:|:-------:|
| 0 | Yandy Diaz | batter_hits_runs_rbis | 4 | 8309 | 0 | 0 | 1 | 8310 | Y | Y |
| 1 | Yandy Diaz | batter_total_bases | 3 | 8309 | 0 | 0 | 1 | 8310 | Y | Y |
| 2 | Jonathan Aranda | batter_hits | 2 | 8309 | 0 | 0 | 1 | 8310 | Y | Y |
| 3 | Jonathan Aranda | batter_hits_runs_rbis | 3 | 8309 | 0 | 0 | 1 | 8310 | Y | Y |
| 5 | Jonathan Aranda | batter_rbis | 0 | 7210 | 0 | 0 | 0 | 7210 | N | N |
| 8 | Jonathan Aranda | batter_runs | 0 | 6006 | 0 | 0 | 0 | 6006 | N | N |
| … | (remaining hits/misses) | … | … | … | 0 | 0 | ≤1 | … | … | … |

**Answer to the three hypotheses:**

1. **One group consumes ~13s?** No — group totals are wait inflation; exclusive prop-sim sync per group ≈ 0.
2. **All 17 consume ~750ms each?** No — A/B show the whole batch is ~14ms when undisturbed.
3. **Time is outside the per-group prop-sim loop?** **Yes** — concurrent Coach CPU during await gaps of `2_context_lookup_build`.

---

## Event-loop / CPU contention

| Probe | Result |
|-------|--------|
| Game-sim **HTTP** overlap during propSim | **0** (warm client game-sim cache; C2 HTTP short-circuit unchanged) |
| Scan-wide `setInterval` delay | max ~7–12ms, p95 ~0 — one solid sync turn blocks the timer |
| C3 drain | **one turn ~16.3s**, CPU ≈ wall |
| C3 CPU profile (hot self time) | see below |

### C3 drain CPU profile (app frames)

| self ms | function | file |
|--------:|----------|------|
| **11372** | `distributionForQuery` | `stadium-mobile/lib/gameSimScoring.ts` |
| **1294** | `coverQueryHits` | `gameSimScoring.ts` |
| **948** | `fgExpectedFromPeriodAverages` | `gameSimScoring.ts` |
| **582** | `periodScoresForDraw` | `gamePeriodScoring.ts` |
| **427** | `simGame` | `coachGameMonteCarlo.ts` |
| (rest) | sanitize / parse / scoreGameLinePick / correlation helpers | mixed |

After that drain completes, warm `runPropSims` is **~20ms** with the same cache stats.

---

## Why A/B looked “impossible” vs C

Coach starts `propPhaseP` overlapping the game-scoring loop (`shouldOverlapPropPhaseWithGames`). The monkeypatched `/simulate/props` handler awaits inside context load; the event loop then runs **local** `simGame` → `distributionForQuery` over the slate. That work is not `/sports/simulate` HTTP, so earlier gameSim-overlap probes reported 0 while still burning ~13–16s CPU.

---

## What was not changed

- runs/RBIs mapping, cache TTL, simulations, candidate caps, thresholds, qualification, grading, ALT logic, correlation/diversity
- No production `propSimRunner` edits left in place (instrumentation is audit-copy only)
- No merge, deploy, OTA, or build

---

## Bottom line

1. Warm prop distributions are already hot (**dist 17H/0M**); true prop-sim after ctx resolve is **~13ms**.
2. The **~13.2s “server compute”** is **Coach local game MC scoring** interleaved with propSim awaits — accounted for in phase 2 wall/CPU, reconciled to ~0 unexplained once occupancy is included.
3. MLB runs/RBIs mapping remains a **separate coverage issue**, not this latency.
4. Next optimization target (when allowed): **game-sim scoring path** (`distributionForQuery` / slate eval), not prop dist/history caches — and/or avoid overlapping that sync work with propSim on the same thread.
