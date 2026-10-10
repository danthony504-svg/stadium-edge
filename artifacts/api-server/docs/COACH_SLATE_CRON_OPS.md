# Coach slate cron — Render + GitHub configuration

**Service that serves the cron endpoint:** the Render **web service** for Stadium Edge API  
(public host `stadium-edge.onrender.com`, Express `api-server`, header `x-render-origin-server: Render`).  
Route: `POST /api/coach/slate/cron` in `artifacts/api-server/src/routes/coachSlate.ts`.  
There is **no** separate Render Cron Job required if GitHub Actions posts every 2 minutes; the **same web service** runs `runCoachSlateJob()` in-process.

**Not a native rollback asset:** any uploaded `stadium_edge_mobile_final_v11*.zip` is a **web asset package**, not a verified iOS embedded rollback build. Do not treat it as known-good native recovery.

---

## 1. Verify Postgres table (production)

Requires the Render Postgres `DATABASE_URL` (Dashboard → Postgres → Connection string).  
Do **not** paste the URL into git/chat.

```bash
# From repo root, with production DATABASE_URL in the env (ops machine only):
DATABASE_URL='…' node artifacts/api-server/scripts/verify-coach-slate-db.mjs
```

Expected schema (`lib/db/src/schema/coachPrecomputedSlate.ts`):

| Column | Type |
|---|---|
| `id` | `text` PK (row `global`) |
| `fingerprint` | `text` NOT NULL |
| `data` | `jsonb` NOT NULL (full slate snapshot) |
| `deep_sim_complete` | `boolean` NOT NULL |
| `computed_at` | `timestamptz` NOT NULL |
| `updated_at` | `timestamptz` NOT NULL |

- Exit **1** = table/schema missing or empty payload  
- Exit **2** = table OK but no `id=global` row yet (run cron once)  
- Exit **0** = table + snapshot row OK  

If the table is missing (with approval):

```bash
DATABASE_URL='…' pnpm --filter @workspace/db run push
```

---

## 2. Configure `COACH_SLATE_CRON_KEY` on Render (secure)

1. Generate a long random secret (do not reuse Clerk/RC keys), e.g.  
   `openssl rand -hex 32`
2. Render Dashboard → **Web Service** for `stadium-edge.onrender.com` (api-server) → **Environment**
3. Add:
   - `COACH_SLATE_CRON_KEY` = `<the secret>`  
   - Optional aliases already accepted by code: `PREBUILD_CRON_KEY` or `NOTIFY_CRON_KEY` (same value OK if already used)
4. **Save** (service redeploys / picks up env — confirm in Events)
5. Smoke without leaking the key:

```bash
# Expect 403 (key required but wrong) after config — proves endpoint is armed
curl -sS -o /tmp/out -w "%{http_code}" -X POST \
  -H "x-cron-key: deliberately-wrong" \
  https://stadium-edge.onrender.com/api/coach/slate/cron
# Before config: 503 {"error":"cron not configured"}
# After config + wrong key: 403 {"error":"forbidden"}
```

Never commit the secret. Never put it in `eas.json` or mobile env.

---

## 3. Configure matching GitHub Actions secrets

Repo → **Settings → Secrets and variables → Actions**:

| Secret | Required | Value |
|---|---|---|
| `COACH_SLATE_CRON_KEY` | **Yes** | Exact same string as Render |
| `COACH_SLATE_CRON_URL` | Recommended | `https://stadium-edge.onrender.com/api/coach/slate/cron` |

Workflow `.github/workflows/coach-slate-cron.yml`:

- Missing key → **exit 1** (no silent success)
- URL must be the production Render path above (legacy Replit rejected)
- Non-2xx, empty body, non-JSON, `ok !== true`, or `summary.reason=error` → **exit 1**

---

## 4. Production cron URL (canonical)

```
https://stadium-edge.onrender.com/api/coach/slate/cron
```

Header: `x-cron-key: <COACH_SLATE_CRON_KEY>`

---

## 5. First authenticated refresh (after secrets)

```bash
export COACH_SLATE_CRON_KEY='…'   # ops shell only
curl -sS --max-time 300 -X POST \
  -H "x-cron-key: $COACH_SLATE_CRON_KEY" \
  -H "Accept: application/json" \
  https://stadium-edge.onrender.com/api/coach/slate/cron | tee /tmp/slate-cron.json
```

Expect HTTP **200** and JSON like:

```json
{
  "ok": true,
  "summary": {
    "skipped": false,
    "durationMs": 12345,
    "sports": 6,
    "oddsCount": 80,
    "propPoolCount": 40,
    "boardScanPicks": 25,
    "ticketSizes": 8,
    "deepSimComplete": true
  }
}
```

Or `skipped: true, reason: "already-running" | "unchanged-fresh"` on overlap/warm cache.

Then:

```bash
# DB row
DATABASE_URL='…' node artifacts/api-server/scripts/verify-coach-slate-db.mjs

# Public GET (no auth) — structure only
curl -sS https://stadium-edge.onrender.com/api/coach/slate | jq '{
  fresh, instantServe, refreshing, computedAt, deepSimComplete,
  activeSports, premiumUnlocked,
  boardPicks:(.snapshot.boardScan.picks|length? // 0)
}'
```

Pass criteria when eligible markets exist:

- `computedAt` non-null  
- `activeSports` non-empty  
- `fresh: true` **or** (`instantServe: true` and snapshot present)  
- `premiumUnlocked: false` for anonymous  
- Locked free users: pick identity redacted (`••••••` / odds 0) — no premium leak  

Also: Actions → **Coach slate cron** → **Run workflow** once; job must be green with validated body.

---

## 6. Deploy note for fail-closed cron HTTP

Returning **500** when `runCoachSlateJob` fails (`ok: false`) requires the api-server commit that includes the route change to be **deployed** to Render. Until then, GH Actions validation still catches empty/`ok` issues once the key works; deploy when approved.

---

## Scope freeze

Do not change Clerk, RevenueCat, Coach selection/odds/grading/sim algorithms, NCAAF safeguards, or Simulator V2 as part of cron recovery.
