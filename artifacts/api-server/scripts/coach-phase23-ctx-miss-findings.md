# Phase 2.3 — Four Persistent propsim-ctx Misses (FINDINGS ONLY)

**Mode:** audit only — **no code changes, no merge / deploy / OTA / EAS**  
**Artifact:** `/opt/cursor/artifacts/coach-phase23-ctx-miss-audit.json`

---

## The four misses (identical every warm run)

| # | candidate/player | sport | stat (market) | game | ctx cache key | why miss | underlying calls | start→end | wall |
|---|------------------|-------|---------------|------|---------------|----------|------------------|-----------|------|
| 1 | Jonathan Aranda | mlb | batter_rbis (RBI) | NYY @ TB | `mlb\|jonathan aranda\|batter_rbis\|40810\|\|U\|\|\|\|100.00\|4\|8\|` | `buildPropSimulationContext` → **null** (`stat_mapping_failed`) | `fetchEspnPlayerHistory` (auth hit) → `statSeries` → **no `setCachedPropSimCtx`** | ~7466→7466 | **0ms** (hist local) |
| 2 | Jonathan Aranda | mlb | batter_runs (R) | NYY @ TB | `mlb\|jonathan aranda\|batter_runs\|40810\|\|U\|\|\|\|100.00\|4\|8\|` | same | same | ~7466→7466 | **0ms** |
| 3 | Liam Hicks | mlb | batter_runs (R) | NYY @ TB | `mlb\|liam hicks\|batter_runs\|4725251\|\|U\|\|\|\|100.00\|4\|8\|` | same | same | ~7466→7466 | **0ms** |
| 4 | Liam Hicks | mlb | batter_rbis (RBI) | NYY @ TB | `mlb\|liam hicks\|batter_rbis\|4725251\|\|U\|\|\|\|100.00\|4\|8\|` | same | same | ~7466→7466 | **0ms** |

Keys **stable** warm-1 ↔ warm-2 (sameKeys=true, zero field changes). Store after warm: **ctxEntries=17, distEntries=17** — the four never enter the store.

---

## Exact cause (why every identical warm request)

History **is present** (10 recent games; labels include `R`, `RBI`; sample stats have `R:"1"`, `RBI:"1"`).

`diagnosePropSimNullReason` → **`stat_mapping_failed`** (`recentValues.length === 0`).

Root cause: **server `propStatValue.ts` `MARKET_SINGLE` omits `batter_rbis` / `batter_runs`**, while mobile `propStats.ts` maps them (`batter_rbis:["RBI"]`, `batter_runs:["R"]`).

```
// mobile propStats.ts — HAS
batter_rbis: ["RBI"],
batter_runs: ["R"],

// api-server propStatValue.ts — MISSING those keys
batter_hits: ["H"],
batter_home_runs: ["HR"],
batter_stolen_bases: ["SB"],
batter_total_bases: ["TB"],
// no batter_rbis / batter_runs
```

Same athletes **succeed** for `batter_hits`, `batter_home_runs`, `batter_total_bases`, `batter_hits_runs_rbis` (those keys exist) → 17 ctx hits.

Path in `propSimRunner` on miss:

1. `getCachedPropSimCtx` miss  
2. `loadPropHistory` / ESPN (auth store)  
3. `buildPropSimulationContext` → **null**  
4. **return without `setCachedPropSimCtx`** ← deliberate non-cache of failed context  
5. no fingerprint → no dist lookup for that group  

So they miss forever — not freshness, not TTL.

### Checklist

| Check | Result |
|-------|--------|
| Key instability | **No** — identical keys across warm runs |
| TTL/expiration | **No** — consecutive warms; TTL 30m; never written |
| Cache capacity/eviction | **No** — uncapped dedicated Map |
| Separate process/store | **No** — in-process dedicated store shared across warms |
| Fields changing between requests | **No** |
| Fingerprint before ctx lookup | **No** — ctx key = shared parts only |
| Enrichment-only entering ctx prep | **No** — scanner deep-sim candidates |
| Failed/unresolved context not cached | **YES — primary** |
| Cache write not occurring | **YES** — for these 4 |
| Cache read/write key mismatch | **No** |

**Verdict:** Not legitimate freshness-sensitive Phase 2.1 ctx participants. They **fail stat mapping**, so Phase 2.1 correctly refuses to cache a null context. Client/server market→stat drift.

---

## Dist-hit path (critical)

Exact order in `runPropSims`:

1. Group by `propSharedDistributionKey(parts)`  
2. **`getCachedPropSimCtx(parts)`** — no dist lookup yet  
3. On miss: history → `buildPropSimulationContext` → fingerprint → `setCachedPropSimCtx`  
4. On build null: stop (no dist)  
5. On success: `distKey = propDistributionCacheKey(parts, fingerprint, tier, simCount)`  
6. `getCachedPropDistribution(distKey)` → score from samples  

Observed warm: **17/17 dist hits among ctx hits**; **0** of the 4 misses reach dist.

**Why ctx work runs before a dist hit can be returned:** dist identity **embeds `historyFingerprint`**, which is derived from ctx material (`recentValues`, vsOpp, home/away, minutes, discrete). There is no fingerprint-free dist key by design (invalidation when history/context changes).

**Can we get dist identity without expensive ctx acquisition?** Not with the current key design without a new secondary index (e.g. parts→lastFingerprint) that still invalidates when history material changes — which is what the ctx cache already is. **Do not remove fingerprints.** For these 4, dist is irrelevant: they never produce a fingerprint.

**13.2s reconciliation:** With auth history warm, these 4 cost **~0ms** and full warm `propSimElapsedMs≈16ms` (ctx 17/4, dist 17/0, histLoads=4). Prior ~13.2s coincided with `historyLoads=4` when ESPN/auth acquisition on the miss path was still expensive — **provider/history work on uncacheable failures**, not MC draws (dist already 17/0). Sticky miss **count** remains; cost collapses once history is local.

---

## 17 hits vs 4 misses

| field/key difference | 17 hit group | 4 persistent misses |
|----------------------|--------------|---------------------|
| sport | mlb | mlb |
| isHome / team ids / pace / injuries / weather | same shape (`U`, empty team ids, leaguePace 100, inj 4/8) | identical |
| **market** | `batter_hits`, `batter_home_runs`, `batter_total_bases`, `batter_hits_runs_rbis` | **`batter_rbis`, `batter_runs` only** |
| athleteId | includes 40810, 4725251 among others | **only** 40810 + 4725251 |
| history present | yes | yes (10 games, R/RBI in stats) |
| `statSeries` / build | ok → ctx written | **`stat_mapping_failed` → never written** |
| dist | 17/17 hits | never reached |

---

## QA 13,596 → 13,599 (+3)

Current report category **`terminal_state`: passed 3**.

Added by `runAbsoluteTerminalHangGuardSuite()` in commit `c904bacd` (*hang audit + permanent terminal-state QA gate*), wired into `runCoachQa.ts`:

1. `term-rc1-routing` — soccer→5 leg must not inherit propsOnly  
2. `term-budget-finite` — absolute budgets finite  
3. `term-session-handoff-clears-timer` — session latch clears hang timer  

**Intentional** Phase-2 hang/terminal regression coverage. **Not** deleted/replaced baseline cases. 13596+3=13599. Phase 2.3 sharing did not alter the count.

---

## TypeScript — Phase 2.3 introduced zero new errors

### API (`artifacts/api-server`) — 132 pre-existing errors

Error files include: `coachBuild.ts`, `coachSlate*`, `fightPickAnalysis.ts`, `liveSteals.ts`, `ufcGames.ts`, various `routes/*`, etc.

**Phase 2.3 server files: 0 errors**  
`authoritativePlayerHistory.ts`, `espnPlayerHistory.ts`, `propSimRunner.ts`, `propSimDedicatedStore.ts`, `routes/simulate.ts`.

### Mobile — pre-existing noise

Touched-file errors are at lines **unchanged** by Phase 2.3 hunks:

- `boardMarketScanner.ts` — PropFillPick / rubricScores / stagedPickCount (present on parent; 2.3 only shared-hist wire + `SLATE_SIM_BATCH` 2→4)  
- `lib/api.ts` — `signal` / `authTokenGetter` far from PropSimFetchResult hunk  
- `app/prop/[id].tsx` — `PlayerSearchHit.team` / `oppName` (2.3 only `map.hits.get`)  
- `coachFootballPropsOnlyTicket.ts`, `propSelection.ts` — pre-existing type mismatches  

**No new TS errors in Phase 2.3-introduced server modules; no new error classes from the 2.3 hunks.**

---

## Bottom line

1. Four sticky ctx misses = **Aranda/Hicks × batter_rbis/batter_runs**.  
2. Cause = **server stat-map missing those markets** → build null → **never cached**.  
3. Not Phase 2.1 key/TTL/eviction bugs; not freshness.  
4. Dist hits require fingerprint from ctx first — by design.  
5. Do not “fix” by extending TTL or dropping fingerprints.  
6. QA +3 = intentional terminal hang-guard suite.  
7. Phase 2.3 added **zero** new TypeScript errors.

No optimize / merge / deploy in this turn.
