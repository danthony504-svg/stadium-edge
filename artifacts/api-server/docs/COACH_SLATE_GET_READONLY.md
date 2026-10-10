# GET /api/coach/slate — read-only (stability)

## Root cause (Render edge 502 ~20–25s after slate GET)

1. `GET /api/coach/slate` loaded the DB row; on cold-miss / stale it called
   `scheduleCoachSlateRefresh(...)`.
2. That helper **fire-and-forgot** `runCoachSlateJob()` **after** the HTTP 200
   returned (job continues past the request).
3. The job does in-process odds fan-out, board scan, and deep sim on the **same**
   web dyno — high CPU/memory.
4. Concurrent GETs could each see `!jobRunning` before the first set the flag
   (race) or repeatedly re-trigger work after a crash.
5. ~20–25s later Render served **edge 502 HTML** (no Express origin) while the
   process was killed/restarting — consistent with OOM/watchdog, not a new deploy.

PR #673 (cron fail-closed reporting) does not change this GET path.

## Minimal fix

- GET only **reads** `coach_precomputed_slate` and returns
  `refreshing: true` when stale/missing — **never** starts generation.
- Full generation stays on authenticated `POST /api/coach/slate/cron`.
- `scheduleCoachSlateRefresh` is a **no-op** (defense in depth).
- `runCoachSlateJob` remains single-flight (`already-running`) for cron.

## Worker / more Render RAM?

**Not required to stop GET-induced 502s** — removing GET kickoff is sufficient
for that failure mode. A larger instance or dedicated worker may still help
**cron** duration/reliability once secrets are configured; that is separate from
this stability fix.
