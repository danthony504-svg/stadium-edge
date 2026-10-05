# Phase 2.4 — `distributionForQuery` reuse audit (findings only)

**Mode:** AUDIT / BENCHMARK ONLY — no merge, deploy, OTA, EAS, no worker threads, no Phase 2.1–2.3 cache changes, N=10_000 unchanged.  
**NFL 7:** separate.

**Artifacts:**
- `/opt/cursor/artifacts/coach-phase24-dist-reuse-audit.json`
- Harness: `artifacts/api-server/scripts/coachPhase24DistReuseAudit.ts` (+ `phase24DistAuditState.ts`)
- Temporary hooks in `gameSimScoring` / `boardMarketScanner` were used for the run and **reverted** (not shipped).

---

## What `distributionForQuery` actually produces

Output: `{ mean, median, stdev }` of a **value series** built from FG `outcomes.homeScores/awayScores` only.

| kind | value series | uses line? | uses totalSide? | uses period? |
|------|--------------|:----------:|:---------------:|:------------:|
| ml | 0/1 win by teamSide | no | — | **no** |
| spread | margin h−a or a−h by teamSide | **no** | — | **no** |
| total | h+a | **no** | **no** | **no** |
| teamTotal | h or a by teamSide | **no** | **no** | **no** |
| raceTo | (no series; null/projection fallback) | — | — | — |

**Implication:** alt lines and over/under that share `(kind, teamSide)` on the same outcomes object need **one** distribution compute. Cover **hit probabilities** still apply thresholds per line via `coverHitRates` / `coverQueryHits` — that is separate from this mean/median/stdev walk.

---

## Call instrumentation (one exact `5 leg` scan)

| metric | value |
|--------|------:|
| `distributionForQuery` calls executed | **12 527** |
| unique reuse keys (`materialFp \| kind \| teamSide`) | **165** |
| duplicate extra calls | **12 362** (98.7%) |
| seed | **null** (game MC unseeded) |
| simulations | 10 000 |

By kind: teamTotal 4681 · spread 3858 · total 3646 · ml 342.  
By period label on the pick/query: fg 9364 · h1 1039 · h2 736 · q1–q4 ~1247 · f5/i1 141 — **but dist still used FG series for all** (period ignored).

Top duplicate group example: Saints/Falcons `teamTotal|away` **804×** (many lines × periods × re-entries) for one identical base series.

**Unique distributions actually required vs executed:** **165 vs 12 527**.

---

## Market shareability vs base 10K draws

Base draw structure on `CoachGameSimEntry`: only FG score pairs (`homeScores[N]`, `awayScores[N]`). No period arrays.

| market | classification | proof |
|--------|----------------|-------|
| Moneyline (FG) | **same base distribution** | Compare h vs a on each FG draw |
| Spread / alt spread (FG) | **derived from base** | Margin series identical for all lines on a teamSide; line only changes cover threshold |
| Game total / alt total (FG) | **derived from base** | `h+a` series identical for all lines / over-under |
| Team total / alt (FG) | **derived from base** | Team score series; line/side only for covers |
| First half / halves | **requires distinct / seeded period model** | No H1 draws stored; `periodScoresForDraw` scales FG with **`Math.random()` ±7%** — two passes over same FG draws **do not** match |
| Quarters / periods | **requires distinct / seeded period model** | Same as halves; unsupported period×sport → NaN (no FG fallback) |
| Race to | **requires distinct / seeded model** | `raceToHits` uses `Math.random` walk |

Do **not** treat period markets as shareable pure functions of the FG 10K without fixing/seeding the period RNG.

---

## Benchmark A / B / C (same `5 leg` workload, warm context after prime)

| option | dist calls | unique dists | dist CPU (sum) | Coach wall | max event-loop delay | propSim observed wall |
|--------|-----------:|-------------:|---------------:|-----------:|---------------------:|----------------------:|
| **A — current** | 12527 | 165 | **14395ms** | **28604** | **9011** | **10258** |
| **B — reuse only** | 12527 | 165 | **153ms** (12362 cache hits) | **12371** | 6011 | **4877** |
| **C — B + yield/game** | 12527 | 165 | **150ms** | **11134** | **3493** | **763** |

- **B** eliminates ~99% of `distributionForQuery` CPU (14.4s → 0.15s). Coach wall ~2.3× faster. propSim still multi-second → remaining sync (`coverQueryHits` / period / other scoring) still starves.
- **C** (yield `setImmediate` after each game in the score batch) drops propSim observed wall **10258 → 763** and max loop delay **9011 → 3493**. Closer to the “propSim stays responsive” goal; not yet millisecond-class under full board.
- Workers **not** implemented; B+C already remove the dist hotspot. Next CPU after B is cover/period path (~2s class from prior profile), not another full 14s dist walk.

---

## Determinism

| check | result |
|-------|--------|
| FG cover rates from same outcomes (twice) | **identical** |
| Period scores from same FG draws (twice) | **not identical** (`Math.random`) |
| Ticket fingerprint A vs B vs C (sequential live scans) | **differed** |

**RNG dependency (do not silently accept):**
- `distributionForQuery` has **no RNG** — B is bit-identical for a fixed `outcomes` object; call-order changes do not change FG dist stats.
- Game 10K draws: **`Math.random` only** (no seed API).
- Period / race paths: **`Math.random` per draw/step** — tickets can diverge across runs even with B/C.
- Sequential A/B/C Coach runs also see live slate/prop variance.

**Design for future reuse:** canonical material game key + retain one outcomes array; cache dist stats by `(outcomesIdentity, kind, teamSide)`; for period markets either seed period noise from draw index or store period draws explicitly — do not claim period shareability until that exists. Fixture tests for A≡B should freeze outcomes and stub period RNG.

---

## Event-loop target

Multi-second stalls are **not** acceptable.  
B removes dist-driven stalls; C cuts remaining batch stalls enough that propSim falls from ~10s to **~0.8s** on this workload. Further yielding around `coverQueryHits` / period re-derive (or precomputing cover rates once per query id) is the next lever — still without cutting 10K or weakening the model.

---

## Recommendation (implementation later — not this PR)

1. **Ship B first:** memoize `distributionForQuery` by material outcomes + kind + teamSide (not line/period/totalSide).  
2. **Add C-style yields** between games (or every N heavy cover walks) so prop/network promises resume.  
3. **Do not** reuse period markets off FG draws until period RNG is deterministic/seeded.  
4. Leave Phase 2.1–2.3, N=10K, odds, thresholds, grading, correlation, NFL7 untouched.  
5. Workers only if post-B/C loop delay still exceeds target.
