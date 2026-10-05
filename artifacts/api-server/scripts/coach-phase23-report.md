# Phase 2.3 — Authoritative History Reuse + Game-Sim Batch 4

**PR:** https://github.com/danthony504-svg/stadium-edge/pull/618  
**Branch:** `cursor/coach-phase23-hist-reuse-def8`  
**Mode:** implemented + tested — **no merge / deploy / OTA / EAS**

---

## Field map (before implementation)

| field | propsim requires | grading/enrichment requires | shareable? |
|-------|------------------|----------------------------|------------|
| sport | yes | yes | **yes** (identity) |
| athleteId | yes | yes | **yes** (identity) |
| labels | yes | yes | **yes** |
| recent[].stats | yes | yes | **yes** |
| recent[].isHome | yes | yes | **yes** |
| recent[].opponentId | yes | yes | **yes** |
| recent[].date | no (stripped historically) | yes | enrich-only projection from same games |
| recent[].opponentName | no | yes | enrich-only projection from same games |
| vsOpponent[].stats | yes | yes | **yes** |
| vsOpponent[].date | no | yes | enrich-only |
| minutesTrend | unused in propsim shape† | yes | enrich-only (†preserve MC — do not inject into propsim shape) |
| windows / seasonSummary | no | API-route only | not board-enrich |
| oppPace / injuries / weather | game ctx | separate | **not** history store |
| history fingerprint | yes (derived) | no | propsim-only |

† Propsim `PlayerHistoryShape` historically omitted minutesTrend; injecting it would change MC equations.

---

## What changed

### A. Authoritative shared history
- New `authoritativePlayerHistory.ts` — 30m TTL, key `sport|athleteId`, single-flight coalesce
- `fetchEspnPlayerHistory` → loads via shared store, projects propsim shape (no date/opp name/minutes)
- `runPropSims` returns `playerHistories` for every athlete in the batch
- `/sports/simulate/props` includes `playerHistories` + `historyShared` / `historyCoalesced`
- Client `enrichCoachPropSimHits` **still runs** but reuses shared histories first; seeds client context cache; falls back to `getPlayerHistory` only when missing

### B. Freshness
- TTL **30m** = existing enrichment path + ESPN `cachedJson` + propsim-ctx — not staler
- Identity-scoped keys; opponent filter at read time

### C. Single-flight
- `withInflightCoalesce` on auth-hist key; cleared on success **and** failure

### D. Game sims
- Default `SLATE_SIM_BATCH` **2 → 4** (not 6)
- Scoring iterates `gameEntries` batch order (completion-order independent)

---

## Performance (submit → final)

Baseline fresh (pre-2.3): **min 26.0 / median 29.1 / mean 29.5 / max 34.5**

| scenario | wall | hist wall | hist calls | hist H/M | shared/coalesced | gameSim wall | propSim wall | qualified | final |
|----------|-----:|----------:|-----------:|----------|------------------:|-------------:|-------------:|----------:|------:|
| fresh 5 (sample) | 29064 | **1697** | 16 | 0/16 | 9 / 0 | 17283 | 441 | — | 5 |
| repeat 5 (mean of 5) | **16972** | **0** | **0** | — | 9 | 288 | 10742 | — | 5 |
| soccer → 5 | 26523 | 1483 | 16 | — | 8 | — | — | — | 5 |
| NFL 7 | 11994 | 0 | 0 | — | — | — | — | — | 6 |

### Fresh 5 × 5

| | ms |
|--|---:|
| min | **24796** |
| median | **27245** |
| mean | **27191** |
| P95/max | **29757** |

vs baseline max 34.5s → **29.8s**; median 29.1 → **27.2s**.

### Repeat 5 × 5

| | ms |
|--|---:|
| min | **15304** |
| median | **15513** |
| mean | **16972** |
| P95/max | **23137** |

**History critical path:** enrich span was **25.475s** finishing at 30.772s → now **~1.7s** on fresh (residual early board-context hist loads, not enrich duplicates) and **0** on warm repeats.

---

## Equivalence / regression gates

| Gate | Result |
|------|--------|
| Authoritative hist + coalesce unit | **PASS** |
| Enrich shared-history unit | **PASS** |
| MC equivalence (seeded) from shared auth | **PASS** |
| propsim-ctx / dist / shared-dist / identity / monteCarlo / wnba | **56/56 PASS** |
| Coach QA | **13,599 / 13,599 PASS**, failed **0**, warnings 96 |
| Unexpected P0 / P1 / P2 | **0** (harness) |
| Touch-module type: coachPropSimFallback null→undefined | fixed |
| Pre-existing mobile tsc noise on boardMarketScanner | unchanged (not introduced by 2.3) |
| API tsc | pre-existing db dist / unrelated route errors |
| #609 / #612 ancestry | **present** (`git merge-base --is-ancestor` exit 0) |
| #341 single-flight / #342 market-agnostic staging | **unchanged** (no edits to those policies) |
| NFL/NCAAF discovery | **unchanged** |

---

## Production files touched

1. `artifacts/api-server/src/lib/authoritativePlayerHistory.ts` *(new)*  
2. `artifacts/api-server/src/lib/espnPlayerHistory.ts`  
3. `artifacts/api-server/src/lib/propSimRunner.ts`  
4. `artifacts/api-server/src/lib/propSimDedicatedStore.ts`  
5. `artifacts/api-server/src/routes/simulate.ts`  
6. `artifacts/stadium-mobile/lib/coachPropSimFallback.ts`  
7. `artifacts/stadium-mobile/lib/boardMarketScanner.ts` (`SLATE_SIM_BATCH=4` + shared hist wire)  
8. `artifacts/stadium-mobile/lib/api.ts` (prop-sim fetch returns histories)  
9. Call-site adapts: `propSelection.ts`, `coachFootballPropsOnlyTicket.ts`, `app/prop/[id].tsx`, `app/(tabs)/props.tsx`

---

## Bottom line

1. History enrichment is no longer the ~25s last blocker on warm; shared authoritative history + prop-sim payload reuse collapse client hist HTTP.  
2. Game-sim effective concurrency 2→4 as benched.  
3. Fresh submit→final improved (median ~27.2s / max ~29.8s vs 29.1 / 34.5).  
4. Do **not** merge/deploy until authorized — Render still needs this server change for production clients to receive `playerHistories`.

---

## Follow-up (this turn) — remaining latency variance

See `coach-phase23-latency-variance-report.md` + `coach-phase23-latency-attribution.json`.

- History sharing unchanged.
- Fresh critical path = gameSim provider HTTP (~17s).
- Warm critical path = propSim ctx/history miss (~13.2s every consecutive warm run; reproducible).
- NFL 7→6 = staging after 21 qualified; another legitimate candidate available.
- No merge / deploy / OTA / EAS.
