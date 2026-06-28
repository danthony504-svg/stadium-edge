# [Project name]

_Replace the heading above with the project's name, and this line with one sentence describing what this app does for users._

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string
- Optional env: `REDIS_URL` — when set (e.g. an Upstash/Redis Cloud URL), the
  api-server stores its response cache + rate-limit buckets in Redis so multiple
  server instances share one view. Leave unset for single-instance (in-memory)
  deployments; Redis errors fail over to the in-memory store automatically.
- **AI Coach (Render / direct OpenAI):** set `OPENAI_API_KEY` (required) and
  optionally `OPENAI_BASE_URL` (defaults to `https://api.openai.com/v1`),
  `OPENAI_CHAT_MODEL` (defaults to `gpt-4.1`), and `OPENAI_REASONING_EFFORT`
  (`none` | `low` | `medium` | `high` | `xhigh`, only when the chosen model
  supports it). Replit's `AI_INTEGRATIONS_OPENAI_*` vars only work on Replit
  infrastructure — on Render they produce upstream 401s and the Coach shows
  "AI service is temporarily unavailable."
- **AI Coach (Replit):** `AI_INTEGRATIONS_OPENAI_API_KEY` +
  `AI_INTEGRATIONS_OPENAI_BASE_URL` (managed by Replit AI Integrations). Uses
  model `gpt-5.4` with `reasoning_effort: low` unless overridden.

## Scheduled jobs (cron)

The api-server deploys as **autoscale**, so in-process timers (`setInterval`)
can't be trusted to run. Time-based work is driven by **Scheduled Deployments**
that POST to secured cron endpoints (guarded by the `x-cron-key` header vs
`NOTIFY_CRON_KEY` / `PREBUILD_CRON_KEY`):

- **Notifications + background-build sweeper** — `POST /api/notifications/cron`,
  ~every 15 min. Run command: `bash scripts/notifications-cron.sh` (reads
  `NOTIFY_CRON_URL` defaulting to the published api-server, and `NOTIFY_CRON_KEY`).
  Drives the abandoned-Coach-build sweeper (so a parlay built while the app is
  closed still sends its "ready"/"couldn't finish" push) plus all four push
  triggers and retention pruning. **Required** — without this schedule none of
  the time-based notifications fire. Verify it is live via
  `GET /api/notifications/cron/status` (same `x-cron-key` guard): `everRan:false`
  / 503 means the schedule was never set up or is failing.
- **Cache pre-warming** — `POST /api/prebuild/cron`, every few minutes (the
  warmed odds/games/props caches have ~5 min TTLs). Run command:
  `bash scripts/prebuild-cron.sh` (reads `PREBUILD_CRON_URL` defaulting to the
  published api-server, and `PREBUILD_CRON_KEY` falling back to
  `NOTIFY_CRON_KEY`). The endpoint makes the live instance warm its caches over
  loopback, so it adds no extra Odds API quota beyond a normal page load.

To set up each schedule: from the published project, create a **Scheduled
Deployment** (Publishing tool) with the run command above
(`bash scripts/notifications-cron.sh` on a ~15-min interval for notifications;
`bash scripts/prebuild-cron.sh` on a few-minute interval for pre-warming).
`NOTIFY_CRON_KEY` is already a shared env var, so no extra secret is required.

### Paging when the cron stalls

The notifications run stamps a heartbeat into KV; `GET /api/notifications/cron/status`
(same `x-cron-key` guard) returns **200** when a run happened within the last
~35 min and **503** when the schedule looks stalled. `scripts/cron-monitor.sh`
polls that endpoint and pages a human on any non-200:

- On a healthy 200 it exits 0 quietly.
- On a 503/500/etc. it POSTs an alert to a **Slack-compatible incoming webhook**
  (`MONITOR_ALERT_WEBHOOK_URL`) AND exits non-zero, so the run is also marked
  failed (visible in deployment logs / Replit's deploy-failure notifications) as
  a backstop even if the webhook is unset.

To set it up: create a **second Scheduled Deployment** with run command
`bash scripts/cron-monitor.sh` on a few-minute interval, and set
`MONITOR_ALERT_WEBHOOK_URL` to a Slack/Mattermost incoming webhook (for Discord,
append `/slack` to the webhook URL so it accepts the Slack-style `{"text": …}`
payload). Optional env: `MONITOR_STATUS_URL` (defaults to the published
api-server), `MONITOR_CRON_KEY` (falls back to `NOTIFY_CRON_KEY`),
`MONITOR_ALERT_LABEL` (a prefix like `[prod]`). An external uptime monitor
(UptimeRobot, Better Uptime, etc.) pointed at the same URL with the `x-cron-key`
header works equally well as an alternative to the script.

**Rotating the key:** the monitor reuses `NOTIFY_CRON_KEY` — the same secret the
cron endpoints already use. To rotate without breaking anything, update
`NOTIFY_CRON_KEY` in one go everywhere it lives: the api-server deployment and
every Scheduled Deployment that reads it (notifications, pre-warming, and this
monitor), then redeploy. There is no separate monitor secret to forget. If you
want an independent secret just for the monitor, set `MONITOR_CRON_KEY` and it
takes precedence.

## Scaling

- The api-server rate limits are per-user: `app.set("trust proxy", true)` lets
  Express read the real client IP (Replit's edge proxy overwrites
  `X-Forwarded-For`, so it can't be spoofed), and limiters key on the Clerk user
  id when signed in, falling back to that IP.
- To run more than one api-server instance, set `REDIS_URL`. Without it, cache
  and limits are per-instance only.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- Cross-device sync: DB table in `lib/db/src/schema/userSync.ts` (`user_sync`),
  backend in `artifacts/api-server/src/routes/sync.ts`, mobile client in
  `artifacts/stadium-mobile/lib/api.ts` + saved-slips logic in
  `context/BetSlipContext.tsx`, web tracker logic in
  `artifacts/stadium-edge/src/ParlayBuilder.tsx`.

## Architecture decisions

- Cross-device sync persists one JSON blob per (Clerk userId, namespace) in the
  `user_sync` table via `GET/PUT /api/sync/:namespace`. Namespaces are
  whitelisted (`savedSlips`, `tracker`). Auth is **optional**: signed-out users
  stay fully local; sync only engages when signed in.
- Web auth is cookie-based (same-origin fetch carries the Clerk session, no
  Bearer token). Mobile auth attaches a Clerk Bearer token via `getToken`
  (wired through `AuthTokenBridge` in mobile `app/_layout.tsx`).
- Sync uses pull-then-push: on sign-in a client pulls + merges server state by
  id, then debounce-pushes changes. A session is marked "synced" (which enables
  pushing) ONLY after a successful authenticated 2xx read, so a not-ready token
  can never overwrite the server with empty/stale local data; a failed pull
  retries with backoff.

## Product

_Describe the high-level user-facing capabilities of this app once they exist._

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- The api-server has **no file watcher** in dev — restart its workflow after
  editing routes, or it serves stale compiled code.
- `getSync`/`fetchServerTracker` throw on ANY non-2xx (including 401) on purpose:
  callers must distinguish a real authenticated empty read (`data: null`) from a
  not-ready session. Do not "soften" 401 back to an empty result.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
