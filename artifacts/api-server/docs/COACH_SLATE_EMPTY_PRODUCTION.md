# Production Coach slate empty/refreshing — investigation

**Probe window:** 2026-10-10 (Render `deploymentSha=dbfc9458…`, #670).  
**No picks fabricated; no qualification bypass; Clerk/RC/Coach models untouched.**

---

## Symptom

`GET /api/coach/slate` → **200** with:

- `snapshot: null`
- `fresh: false`, `instantServe: false`, `refreshing: true`
- `computedAt: null`, `activeSports: []`, `deepSimComplete: false`

This is the intentional **degrade path** when no usable DB row exists (`coach_precomputed_slate` id=`global`), not an HTTP 500.

---

## Root cause class: broken refresh pipeline (not empty sports day)

### A. Cron not configured on Render

```
POST /api/coach/slate/cron → 503 {"error":"cron not configured"}
POST /api/prebuild/cron → 503 {"error":"cron not configured"}
POST /api/notifications/cron → 503 {"error":"cron not configured"}
GET  /api/notifications/cron/status → 503 {"error":"cron not configured"}
```

Server requires `COACH_SLATE_CRON_KEY` **or** `PREBUILD_CRON_KEY` **or** `NOTIFY_CRON_KEY`. All unset in the live Render env (from API behavior).

### B. GitHub Actions cron is a silent no-op

Workflow `.github/workflows/coach-slate-cron.yml` runs on `*/2 * * * *` and reports **success**, but latest run log (`38048171554`) shows:

- `COACH_SLATE_CRON_URL/KEY`, `PREBUILD_CRON_KEY`, `NOTIFY_CRON_KEY` all **empty**
- Message: `No cron key configured…` then **`exit 0`**

So the slate is **never** warmed by GH Actions today.  
(Default URL was also legacy `stadium-edge-1.replit.app` — fixed in-repo to `stadium-edge.onrender.com` + fail-closed on missing key; **secrets still must be set by ops**.)

### C. On-demand GET refresh does not heal production

`GET /coach/slate` schedules `scheduleCoachSlateRefresh("cold-miss")` when stale/missing. After trigger:

- Snapshot stayed null for 45s+
- A follow-up GET returned **502 Bad Gateway** (~60s later), consistent with the instance being overloaded or restarted during a heavy board-scan job

Even if background refresh sometimes works, without cron the slate will go cold again.

### D. Providers **do** have real qualified candidates

Public odds (same routes the slate job loopbacks) on Render:

| Sport | HTTP | Games | Pickable in next 48h |
|---|---|---|---|
| mlb | 200 | 2 | 2 |
| nfl | 200 | 26 | 13 |
| ncaaf | 200 | 62 | 46 |
| nhl | 200 | 14 | 14 |
| soccer | 200 | 83 | 36 |
| tennis | 200 | 17 | 12 |
| ufc | 200 | 57 | 23 |
| nba | 200 | 46 | 0 |
| wnba | 200 | 1 | 0 |
| ncaab | 200 | 0 | 0 |

**Conclusion:** Empty `activeSports` on `/coach/slate` is **not** “no games exist.” Markets/providers are available; the **precomputed snapshot pipeline is not persisting a row**.

Genuinely unavailable in-horizon: NBA/WNBA/NCAAB at probe time (0 pickable) — expected; others should populate a healthy slate once cron+job succeed.

---

## What is *not* wrong

- #670 degrade-to-200 behavior (prevents free-user 500s) — working as designed  
- Locked open-parlay SSE — returns `lockedPreview` / subscribe CTA without premium field leak  
- Qualification / selection / grading / sim code — not modified for this investigation  

---

## Ops fix (manual approval required — not executed here)

1. Set on **Render**: `COACH_SLATE_CRON_KEY` (or reuse `PREBUILD_CRON_KEY` / `NOTIFY_CRON_KEY`) to a strong secret.  
2. Set matching **GitHub Actions secrets**: `COACH_SLATE_CRON_KEY` + optional `COACH_SLATE_CRON_URL=https://stadium-edge.onrender.com/api/coach/slate/cron`.  
3. Confirm DB table `coach_precomputed_slate` exists on the Render Postgres (`pnpm --filter @workspace/db run push` if missing — **approval**).  
4. Manually `workflow_dispatch` Coach slate cron **once**; expect JSON summary with `oddsCount` / `boardScanPicks` / `sports` > 0 when markets exist.  
5. Re-probe `GET /api/coach/slate` → `computedAt` set, `activeSports` non-empty when pickable games exist, `refreshing` false when fresh.  
6. If job 502s the service, run cron off-peak / raise Render resources; do **not** lower qualification bars to “fill” the slate.

---

## Distinction summary

| Signal | Meaning |
|---|---|
| `/sports/odds` pickable > 0 but slate `snapshot=null` | **Broken refresh / cron / persist** |
| `/sports/odds` pickable = 0 for all sports | Genuine empty horizon (rare) |
| Slate 200 + redacted locked picks for free users | Expected premium gate — not a pipeline bug |
