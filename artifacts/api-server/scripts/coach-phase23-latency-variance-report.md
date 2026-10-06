# Phase 2.3 — Remaining Latency Variance (AUDIT ONLY)

**PR:** https://github.com/danthony504-svg/stadium-edge/pull/618  
**Branch:** `cursor/coach-phase23-hist-reuse-def8`  
**Mode:** investigate only — **no history-sharing changes, no optimizations, no merge / deploy / OTA / EAS**

Artifacts:
- `/opt/cursor/artifacts/coach-phase23-latency-attribution.json`
- `/opt/cursor/artifacts/coach-phase23-nfl7-shortfall.json`
- `/opt/cursor/artifacts/coach-phase23-e2e-verify.json`

---

## Why the critical path moves (gameSim ↔ propSim)

| Mode | Dominant wall | What actually happens |
|------|---------------|----------------------|
| **Fresh** | **gameSim span ~17.7s** | Client fingerprint cache cold → 18× `/simulate/game-outcome` HTTP. Span≈sum (17.7s≈16.4s). Prop-sim finishes in **~376ms** overlapping the first game batch (~373ms overlap), so it is **not** on the critical path. |
| **Repeat (warm)** | **propSim span ~13.2s** | Game sims are **client-cache hits** (0 HTTP, span=0). Critical path becomes a **single prop-sim wave** with **ctx 17/4 + dist 17/0 + historyLoads=4**. Dist/MC is hot; the 13s is **ctx-miss history reload work**, not Monte Carlo draws. |

**Instrumentation note:** Prior repeat mean `propSimWall≈10.742s` mixed runs (one ~24ms fully-hot outlier + ~13.4s sticky-miss runs) and sometimes **summed** wave walls. Attribution re-bench (cold + 5 consecutive warm) shows **~13.2s every warm run** — reproducible, not an outlier.

---

## Ops tables

### Fresh 5-leg (cold)

| operation | calls | cache H/M | generated | provider/network | server compute | client wait | start/end |
|-----------|------:|-----------|----------:|-----------------:|---------------:|------------:|----------:|
| player_history | 16 | 0/16 | 0 | 5551ms (sum HTTP) | — | **1366ms span** | 4123 → 5489 |
| game_simulation | 18 | 0/18 (client FP) | 18 | **16409ms sum HTTP** | (inside Render responses) | **17743ms span** | 11056 → 28799 |
| prop_simulation | 1 wave | ctx 0/21; dist 0/17 | 17 | 376ms wall | **266ms** (`propSimElapsedMs`) | **376ms span** | 11053 → 11429 |

Cold wall: **29237ms**. Hist residual ~1.4s span (early board context — not enrich duplicates).

### Repeat 5-leg (representative warm-4 / median total)

| operation | calls | cache H/M | generated | provider/network | server compute | client wait | start/end |
|-----------|------:|-----------|----------:|-----------------:|---------------:|------------:|----------:|
| player_history | 0 | 16/0 | 0 | 0 | — | 0 | — |
| game_simulation | 0 | 18/0 | 0 | 0 | — | 0 | — |
| prop_simulation | 1 wave | ctx **17/4**; dist **17/0** | 0 | 13207ms wall | **13200ms** | **13207ms span** | 1868 → 15075 |

Wave detail (all warm runs): `athleteMs≈7`, `injuryMs=0`, `paceMs=0`, `authHist residual≈0`, `historyLoads=4`, `historyShared=8`, scored 17/21.

---

## Classification of large values

### Fresh gameSim ~17s

| Hypothesis | Verdict |
|------------|---------|
| True server compute | **Partial** — Render game-outcome work is inside each HTTP response |
| Cache miss | **Yes** — client game-sim fingerprint 0/18 |
| History/context miss | No (separate hist path already ~1.4s) |
| Request queueing | Mild — outer `SLATE_SIM_BATCH=4` serializes batches; span only ~1.3s above sum |
| Render CPU contention | Possible secondary on shared host; not primary vs 16s sum HTTP |
| Overlapping Promise timing | **Span≈sum** — not a false sum artifact |
| Network wait | **Yes — primary** (provider/network sum 16.4s) |
| Instrumentation attribution | Span correctly marks critical path; sum is true HTTP cost |

### Warm propSim ~13s (also explains prior ~10.7s mean)

| Hypothesis | Verdict |
|------------|---------|
| True server compute / MC draw | **No** — dist **17/0**; MC draws avoided |
| Cache miss (dist) | **No** |
| History/context miss | **Yes — primary** — sticky **ctx 17/4**, `historyLoads=4` every warm run |
| Request queueing | No (single wave) |
| Render CPU contention | N/A for audit intercept (local `runPropSims`); production would add RTT only |
| Overlapping Promise timing | **No** — 1 wave; span≈sum≈elapsed (~13.2s) |
| Network wait | **Yes (ESPN behind the 4 history loads)** — not Coach↔Render prop HTTP (intercepted) |
| Instrumentation attribution | Prior 10.7s mean diluted by one 24ms hot run; consecutive bench proves **~13.2s is the steady warm cost** |

Fully-hot same-prop probe (prior): **3–4ms** when ctx+dist+hist all hit — confirms 13s is miss work, not baseline MC.

---

## Consecutive warm bench (after 1 cold)

Ask: identical `5 leg` × 5.

| run | total wall | hist | gameSim | propSim | ctx H/M | dist H/M | gameSim H/M | final |
|-----|----------:|-----:|--------:|--------:|---------|----------|-------------|------:|
| warm-1 | 18141 | 0 | 0 | 13511 | 17/4 | 17/0 | 18/0 | 5 |
| warm-2 | 19278 | 0 | 0 | 13236 | 17/4 | 17/0 | 18/0 | 5 |
| warm-3 | 15096 | 0 | 0 | 13224 | 17/4 | 17/0 | 18/0 | 5 |
| warm-4 | 15343 | 0 | 0 | 13207 | 17/4 | 17/0 | 18/0 | 5 |
| warm-5 | 15041 | 0 | 0 | 13070 | 17/4 | 17/0 | 18/0 | 5 |

### Stats

| metric | min | median | mean | P95/max |
|--------|----:|-------:|-----:|--------:|
| total wall | 15041 | 15343 | 16580 | 19278 |
| propSim (elapsed) | 13064 | 13218 | 13243 | 13504 |
| gameSim span | 0 | 0 | 0 | 0 |

**Verdict:** ~10.7–13.5s warm propSim is **reproducible** (every run ≥13.0s). Not an outlier.

---

## NFL 7 → 6 (diagnose only)

| Stage | Count / note |
|-------|----------------|
| requested | **7** |
| eligible | propPool **902**, oddsGameCount **1**, gameEntryCount **1** (Falcons @ Saints only on board) |
| simulated | gameSimsLoaded **1**, gameLegsScored **794**, propSimEvaluated **35**, propLegsScored **7** |
| qualified | **scoredBeforeStage = 21** (≥7) |
| correlation/diversity/staging | `requirePropMix=true`; same-game stack caps / diversity |
| final | **6** — all Falcons @ Saints |

**Where the 7th disappears:** `staging_correlation_diversity_or_per_game_cap` — after qualification, not at eligible/sim/qualify.

**Another legitimate qualified candidate available?** **Yes** (21 scored before stage; staging placed 6).

**Do not** lower thresholds or add filler.

---

## Phase 2.3 regression gates

| Gate | Result |
|------|--------|
| Deterministic before/after history inputs (shared auth shape ≡ enrich projection) | **PASS** (`phase23HistoryEquivalence`) |
| Simulation probabilities identical (seeded MC from shared auth) | **PASS** |
| EV/edge / grade/confidence / candidate IDs / ranking / correlation / final ticket | Covered by equivalence + Coach QA (no intentional scoring edits in 2.3) |
| Coach QA | **13,599 / 13,599 PASS**, failed **0**, warnings 96 |
| P0 / P1 / P2 | **0** |
| Identity + propsim-ctx tests | **PASS** (`athleteIdentityCache`, `propSimCtxCache` — 30/30 with auth/equiv) |
| Phase 2.3 sharing tests | **PASS** (`authoritativePlayerHistory`, shared-history enrich) |
| TypeScript | API `tsc`: pre-existing unrelated (`db/dist`, coachSlate*, fightPick*). Mobile: pre-existing boardMarketScanner noise unchanged by 2.3 |
| Touched-module tests | Auth hist + equivalence + enrich shared-history **PASS** |
| PR #341 scan/abort | Phase 2.3 **does not** alter abort policy. Current tree: `AbortSignal` through `buildParlay` → `tryReachFullBoardScan`, `abortRef` stop path in `coach.tsx`, resilience tests intact. Exact `abortCoachBoardScan` registry from #341 commit is **not** on this branch ancestry (`merge-base` miss); equivalent session abort remains. |
| PR #342 staging + NFL/NCAAF discovery | **Intact** — 2.3 only wires shared hist + `SLATE_SIM_BATCH` 2→4; no staging/discovery policy edits |
| #609 / #612 | **Present** (`git merge-base --is-ancestor` exit 0; e2e `ancestry.pr609/pr612: true`) |

---

## Production files changed (Phase 2.3) — classification

| File | Class |
|------|-------|
| `artifacts/api-server/src/lib/authoritativePlayerHistory.ts` *(new)* | **server** |
| `artifacts/api-server/src/lib/espnPlayerHistory.ts` | **server** |
| `artifacts/api-server/src/lib/propSimRunner.ts` | **server** |
| `artifacts/api-server/src/lib/propSimDedicatedStore.ts` | **server** |
| `artifacts/api-server/src/routes/simulate.ts` | **server** |
| `artifacts/stadium-mobile/lib/api.ts` | **mobile** |
| `artifacts/stadium-mobile/lib/boardMarketScanner.ts` | **mobile** |
| `artifacts/stadium-mobile/lib/coachPropSimFallback.ts` | **mobile** |
| `artifacts/stadium-mobile/lib/coachFootballPropsOnlyTicket.ts` | **mobile** |
| `artifacts/stadium-mobile/lib/propSelection.ts` | **mobile** |
| `artifacts/stadium-mobile/app/prop/[id].tsx` | **mobile** |
| `artifacts/stadium-mobile/app/(tabs)/props.tsx` | **mobile** |
| `artifacts/api-server/test/authoritativePlayerHistory.test.ts` | **tests only** |
| `artifacts/api-server/test/phase23HistoryEquivalence.test.ts` | **tests only** |
| `artifacts/stadium-mobile/test/coachPropSimSharedHistory.test.ts` | **tests only** |
| Audit scripts / reports under `artifacts/api-server/scripts/coachPhase23*` | **tests only** |

---

## Bottom line (no optimize yet)

1. History sharing succeeded — hist is off the critical path.
2. Fresh critical path = **cold game-sim provider HTTP** (~17s span).
3. Warm critical path = **propSim ctx/history miss reload** (~13.2s, reproducible), with dist already hot.
4. NFL 7→6 dies at **staging policy** with qualified surplus — diagnose only.
5. Gates green for merge *authorization* later — **do not merge/deploy/OTA/EAS in this turn**.
