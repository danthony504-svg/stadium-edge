# Consolidated preview release — review only

**Deploy / branch tip SHA:** `fa2d3bae6539c4c3368389dae620f833df5aac1e` (timing + API-diff package; tip of branch may include SHA-stamp commits after this)
**Timing package SHA:** `fa2d3bae6539c4c3368389dae620f833df5aac1e`
**Code tip (matchup invariants):** `8e97e3839873324558f441de9ba13c6f32df26f4`  
**Branch:** `cursor/coach-players-only-kb-8b51` · PR #741  
**Status:** Prepared for preview review — **no publication, deploy, merge, or native build**

---

## UNVERIFIED (do not close)

| Item | Status |
|------|--------|
| Telegram device-event ingestion for the 3-of-10 shortfall | **UNVERIFIED** |
| Build 78 IPS crash attribution (vs any tip / today’s OTA) | **UNVERIFIED** |

---

## What this tip contains (Coach)

1. **Opponent context once** — matchup tilt applied to `simHit`; Final AI tendency display-only when `oppMatchupAppliedToSim`
2. **Paired Over↔Under transfer** — `over + under + push ≈ 1`; hits in `[0,1]`; alt Under ladder monotone (no shared 0.98 flatten)
3. **Raw + adjusted retained** — `rawSimHit` / `simHit`; edge, grade, qualification, UI use **adjusted**; UI shows `model X% (sim Y% ±Zpp matchup); n=5, uncalibrated`
4. **Cache/recovery** — second attach skips tilt when `oppMatchupAppliedToSim`
5. **P0 telemetry** — `P0_UNVALIDATED_MARKETS` digests as legitimate underfill (no Telegram page)
6. **Bo Nix audit** — raw 0.9705 → model ~0.993 via matchup transfer (n=5 uncalibrated); not soft-cap raise
7. D/ST ask locks + Tackles+Assists grade (earlier commits on branch)

---

## Focused test results

| Suite | Result |
|-------|--------|
| `simHitMatchupAdjust.test.ts` (paired, push, alt mono, alreadyApplied) | **4/4 pass** |
| `footballOppContextPipeline.verify.test.ts` + rushDefense + adjust | **45/45 pass** |
| `api-server` `coachReliability.test.ts` | **18/18 pass** |

**Consistency:** grade / edge / qualification / UI share adjusted `0.993`; raw `0.9705` retained; paired O+U+push sum `1.000`.

---

## Full-scan cold / warm walls (parent vs tip)

Live ask `5 leg` via `buildCoachParlay` (`COACH_QA_RUN_PERF_MEASURE=1`), against **live** Render API. Cold = clear client context cache then scan; warm = immediate repeat. Agent host — not device.

| Client SHA | Role | Cold | Warm | Legs |
|------------|------|-----:|-----:|-----:|
| `2444d2e4c8631a3fed655ee98a116c1bf157e216` | **Parent** (pre opp-context-once) | **61077 ms** (61.1 s) | **36963 ms** (37.0 s) | 5 / 5 |
| `9705fc535b8166abb9182e23511fcff39c4fc0f7` | **Tip** (consolidated preview) | **45858 ms** (45.9 s) | **25440 ms** (25.4 s) | 5 / 5 |
| Δ (tip − parent) | | **−15219 ms** | **−11523 ms** | |

Artifacts: `docs/coach/coach-fullscan-parent-vs-tip.json`, `/opt/cursor/artifacts/coach-fullscan-parent-2444d2e4.json`, `/opt/cursor/artifacts/coach-fullscan-tip-9705fc53.json`.

### Micro (cache / scoring only — not user-visible ask duration)

| Path | Cold | Warm |
|------|-----:|-----:|
| Team-defense context cache | 28.3 ms | ~0 ms |
| Scoring 200×6 markets (tip one-application) | — | 17.8 ms |
| Scoring 200×6 markets (parent double-count) | — | 13.1 ms |

---

## API: live vs deploy SHA + exact diff

| | SHA |
|--|-----|
| **Live Render** `GET /api/healthz` → `deploymentSha` | `ddeb4733348b98d7112748edc19c7e06fc6fc99a` |
| **Deploy this tip** (when approved) | branch tip including this package (see stamp below) |

### Exact `artifacts/api-server` src/test delta vs live `ddeb4733`

```
 artifacts/api-server/src/lib/coachReliabilitySanitize.ts |   8 +
 artifacts/api-server/src/lib/explicitMarketLock.ts       |  38 ++++-
 artifacts/api-server/src/lib/gradePropMarket.ts          | 172 +++++++++++++++++++++
 artifacts/api-server/src/routes/defense.ts               |  23 ++-
 artifacts/api-server/src/routes/grade.ts                 |  39 +++--
 artifacts/api-server/test/coachReliability.test.ts       |  44 ++++++
 6 files changed, 308 insertions(+), 16 deletions(-)
```

Full patch: [`docs/coach/api-diff-vs-live-ddeb4733.patch`](./api-diff-vs-live-ddeb4733.patch)

**P0-only hunk** (required for digest ingest; live still lacks this):

```diff
+    case "P0_UNVALIDATED_MARKETS":
+      return {
+        eventType: "parlay_underfilled",
+        failureReason: "legitimate_underfill",
+        alertable: false,
+      };
```

Also lands vs live: `gradePropMarket` (Tackles+Assists canonical grade), `explicitMarketLock` / `defense` / `grade` route wiring for D/ST + prop grade.

---

## Deploy scope (when approved — not now)

| Surface | Needed? | SHA / note |
|---------|---------|------------|
| **API server deploy** | **Yes** | Deploy tip SHA → confirm `/api/healthz` `deploymentSha` matches |
| **Client preview OTA** | **Yes** (primary) | Same tip JS bundle to preview channel |
| Native / EAS build | **No** | JS-only |
| Production OTA | **No** | Preview review only |
| Telegram / Build 78 | **No action** | Remain UNVERIFIED |

Order when approved: **API first**, then preview OTA. **Neither authorized in this turn.**

---

## Review gates before any publish

- [ ] Human review of PR #741
- [ ] After API deploy: `deploymentSha` equals tip
- [ ] Device: paired O/U display, n=5 label; do not treat Telegram/Build 78 as resolved

**No publication · no deploy · no merge · no native build**
