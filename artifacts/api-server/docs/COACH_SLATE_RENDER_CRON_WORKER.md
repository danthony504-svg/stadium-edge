# Coach slate — Render Cron Job worker

## Why
Running `runCoachSlateJob()` inside the web service caused Render edge **502**
(run #1405, ~36s) while the origin died mid-request. Generation is isolated on a
**Render Cron Job** using the same codebase.

## Worker start command
```bash
node --enable-source-maps ./dist/coachSlateWorker.mjs
```

## Required env (Render Cron Job)
| Variable | Value |
|---|---|
| `DATABASE_URL` | Same production Postgres as the web service |
| `COACH_SLATE_API_BASE` | `https://stadium-edge.onrender.com/api` |
| `COACH_SLATE_WORKER` | `1` |
| `COACH_SLATE_SIM_MODE` | `inprocess` |

Do **not** set `COACH_SLATE_RUN_ON_WEB=1` on the web service (keeps HTTP cron at 410).

## Recommended instance (pending measured RSS)
- **Start:** `2c-4g` (2 CPU / 4 GB)
- **Upsize to `2c-8g`** if peak RSS ≳ 3.2 GB or OOM

## Schedule
Keep **disabled / manual** until ≥3 successful runs. Then:

`interval_min = ceil(clamp(1.5 × p95_duration_min, 5, 12))`

## Cost (estimate)
Cron billed per active minute. Example at `2c-4g` ($0.00197/min):
- p95≈6m, interval 9m → ~**$6/mo**
- near-continuous → ~**$85/mo**

## Guarantees
- Postgres advisory lock for the entire job (`87251433`, `1`)
- Publish only `deepSimComplete=true` to `id=global` (prior snapshot preserved on failure)
- Heavy prop/game sims run **in-process** in the worker (not on the web dyno)
- GET `/api/coach/slate` remains read-only

## GitHub Actions
`.github/workflows/coach-slate-cron.yml` verifies healthz + slate GET.
Optional `workflow_dispatch` can trigger Render via `RENDER_API_KEY` + `RENDER_CRON_JOB_ID`
(note: Render cancels an active run when manually triggered).
