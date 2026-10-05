# Phase 2.3 Prep — Full-Board-Scan Internals Audit (report only)

**Mode:** AUDIT ONLY — no production code changes, no merge, no deploy, no OTA, no EAS  
**Primary sample:** critical-path warm 5-leg (`coach-phase22-critical-path.json`) — scan **26.7s** of **31.0s** submit→final  
**Artifacts:**
- `/opt/cursor/artifacts/coach-phase23-scan-internals-audit.json`
- `/opt/cursor/artifacts/coach-phase23-game-sim-concurrency.json`

Athlete resolution and raw prop MC equations were **not** retargeted.

---

## 1. Overlapping scan intervals (26.7s)

`start/end` are absolute ms from submit. Spans **overlap** — do **not** sum walls.

Scan window: **4342 → 31005** (wall **26663ms**). Ready pool **3758**.

| operation | count | start | end | wall | concurrency | cache H/M | blocks final |
|-----------|------:|------:|----:|-----:|-------------|-----------|:------------:|
| history enrichment (client `getPlayerHistory`) | 23 | 5297 | 30772 | 25475 | `Promise.all` over batch (unbounded within batch) | client hist **35H / 23M** of 58; **no** share with propsim-ctx | **yes** |
| game-simulation batches | 2 HTTP / 19 games | 5196 | 18431 | 13235 | outer **serial** `SLATE_SIM_BATCH=2`; inner pool 4 → **effective 2** | gameSim **17H / 2M** of 19 | **yes** |
| prop simulation request | 3 | 5198 | 19990 | 14792 | 1 client HTTP/wave; server ctx load conc **4** | ctx **17/25**; dist **17/23** | **yes** |
| game-line grading + partial staging | 10 visible | 6673 | 19945 | 13272 | 1 sync after each awaited game batch | n/a | no* |
| prop grading (`attachPickScores` after sim+enrich) | 3 | 5198 | 30895 | 25697 | 1 sync after enrich | n/a | **yes** |
| ALT grading | bundled | 5198 | 19990 | 0 | no separate ALT HTTP — expand from deep-sim `lineHitRatesBySide` | shared dist | **yes** |
| qualification | 13 partials | 5439 | 31005 | 25566 | 1 (`buildScanResult`) | n/a | **yes** |
| EV/edge computation | bundled | 5439 | 31005 | — | inside score/eval | n/a | **yes** |
| correlation scoring | bundled | 5439 | 31005 | — | staging | n/a | **yes** |
| diversity | bundled | 5439 | 31005 | — | staging / inject | n/a | **yes** |
| staging (`fillReservedPropSlots`) | 13 | 5439 | 31005 | 25566 | 1 per partial+final | n/a | **yes** |
| recovery / top-up | finalize | 30895 | 31005 | ~110 | 1 (`topUpTicketFromQualifiedScored`) — not a multi-second network phase | n/a | **yes** |

\*GL partials emit early; **final ticket waits on prop seats**.

---

## 2. Why game sims are serial (batch=2)

**Code:** `boardMarketScanner.buildTopLegsFromFullBoardScan`

```text
for (i = 0; i < games; i += SLATE_SIM_BATCH) {          // default 2; football mix uses 4
  await fetchSlateGameSimulationsWithStatus(batch…)     // inner SLATE_SIM_CONCURRENCY = 4
  scoreGamesAndMaybePartial(batch)                      // emit mid-scan GL partials
}
```

| Finding | Detail |
|---------|--------|
| Why serial outer | Intentional progressive staging — each batch is awaited so newly loaded sims can be graded and partial-emitted before the next games start |
| Not a provider limit | No 429 evidence; inner pool already allows 4 |
| Effective parallelism | Outer batch **2** caps concurrency at **2** even though inner pool is 4 |
| Observed span ~5.2s→18.4s | HTTP sum only **521ms** (2 misses); **17/19** client cache hits. Span is the serial loop overlapping prop/mlb work, not raw provider cost |

---

## 3. Game-sim concurrency bench (identical workload)

12 unique board games (4 MLB + 8 NFL), same 3 cover queries / game, same sim count. Client game-sim cache cleared between levels. Outer chunk size only; **inner still 4**.

| concurrency | simulations | wall ms | errors | 429 | notes |
|------------:|------------:|--------:|-------:|----:|-------|
| **2** | 12 | **1186** | 0 | **0** | production-like default |
| **4** | 12 | **567** | 0 | **0** | ~2.1× faster than 2 |
| **6** | 12 | **786** | 0 | **0** | ≈4 (inner pool caps at 4) |

**Deterministic output differences:** `homeWin` differed by **~0–1.9pp** across sequential cold levels. Magnitude is consistent with production MC **run-to-run noise / live input drift**, not a concurrency-specific equation fork. No status≠200, no 429. Sim counts and cover-query equations were unchanged.

---

## 4. History enrichment vs Phase 2.1 propsim-ctx

| Question | Answer |
|----------|--------|
| Players/stat histories loaded (client HTTP) | **23** misses (`/sports/player-history`) |
| Client cache | **58** calls → **35 hit / 23 miss** |
| Provider calls | Client → API `/sports/player-history` → ESPN gamelog (`cachedJson` 30m) |
| Server propsim-ctx | ctx **17/25**, dist **17/23**; misses call `fetchEspnPlayerHistory` **directly** to ESPN (conc 4) |
| Duplicates | Within-batch: local `Map` by `sport:athleteId`. Cross-path: **yes — duplicate acquisition** |
| Concurrency | Client: unbounded `Promise.all` over full prop batch. Server: `PROPSIM_CTX_LOAD_CONCURRENCY=4` |
| Longest individual client call | **739ms** (sum **10,617ms**; span **5.3s→30.8s**) |
| Loaded again after Phase 2.1 ctx established? | **Yes.** On ctx **hit**, server skips hist reload — client `enrichCoachPropSimHits` **still** always `getPlayerHistory` for form cards (explicit comment: avoid “still loading”) |
| Same history fetched independently by enrich + simulation? | **Yes.** Independent stores/keyspaces: server propsim-ctx / ESPN `cachedJson` vs client `coachContextCache.playerHistory`. Client still pays HTTP RTT even when ESPN is warm server-side |

`propSim ∥ hist enrich` can extend toward **20–31s** because enrich is **awaited inside `simPropBatch`** after each deep-sim wave, and late waves keep the scan open until reserved prop seats fill.

---

## 5. Critical dependency — last blocker

```text
last blocker = history_enrichment (client getPlayerHistory after/alongside prop sim)
```

| | |
|--|--|
| Last HTTP end | player_history @ **30772ms** |
| Props land on ticket | **30895ms** (0 → 2 props) |
| Final return | **31005ms** |

**Why final ticket cannot complete before it:**  
`simPropBatch` → `await enrichCoachPropSimHits` → prop phase promise → `buildTopLegsFromFullBoardScan` only then returns board-exhausted final. `awaitingPropSlots` / `fillReservedPropSlots` need prop-scored legs to replace the GL-only preview. Until that enrich finishes, membership is still the GL-only 5.

### Can remaining work after first 5 GL alter the ticket?

| | alters? |
|--|:-------:|
| qualification | **yes** |
| ranking | **yes** |
| correlation | **yes** |
| diversity | **yes** |
| final 5 selections | **yes** |

Evidence: first 5 at **6673ms** with **0 props**; final at **30895ms** with **2 props**. Do **not** early-exit yet.

---

## 6. Smallest safe Phase 2.3 recommendation

**Primary (smallest, highest leverage):**  
Skip redundant client `getPlayerHistory` in `enrichCoachPropSimHits` when the server MC grade is already usable (`hitProbability` finite, in-range). Optionally return thin history slices with prop-sim rows. **Keep** local hist fallback only for null/unusable MC.

- Expected: remove ~**23** client hist RTTs / ~**10.6s** sum that currently stretches the scan tail to ~31s  
- Preserves: ESPN mapping, 10k sims, markets/ALTs, thresholds, EV/edge/grade/confidence, correlation/diversity, no fabricated history  
- Does **not** change qualification thresholds or MC equations  

**Optional follow-up (same phase if cheap):** raise default `SLATE_SIM_BATCH` **2 → 4** (football mix already uses 4). Bench: ~2× wall cut, **0×429**, progressive partials retained, inner pool already 4.

**Out of scope:** early exit at first 5 GL; athlete-ID work; MC draw caching; changing sim counts/equations.

---

## Bottom line

1. The 26.7s scan is dominated by **propSim ∥ client hist enrich** (last network = hist @ 30.8s) plus **serial game batches** (effective conc 2) overlapping that window.  
2. Game sims are serial **by design** for mid-scan partials; raising outer batch to 4 is safe per bench.  
3. History is **double-fetched**: server propsim-ctx (Phase 2.1) and client enrich (always), independent stores.  
4. **last blocker = history_enrichment**; final ticket cannot finish earlier because prop-seat fill awaits enrich.  
5. Remaining post-5-GL work **does** change the final ticket — no early exit.  
6. Smallest Phase 2.3: **dedupe client hist when MC already graded** (+ optional game batch 2→4).
