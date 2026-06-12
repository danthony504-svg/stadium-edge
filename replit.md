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

## Scheduled jobs (cron)

The api-server deploys as **autoscale**, so in-process timers (`setInterval`)
can't be trusted to run. Time-based work is driven by **Scheduled Deployments**
that POST to secured cron endpoints (guarded by the `x-cron-key` header vs
`NOTIFY_CRON_KEY` / `PREBUILD_CRON_KEY`):

- **Notifications** — `POST /api/notifications/cron`, ~every 15 min.
- **Cache pre-warming** — `POST /api/prebuild/cron`, every few minutes (the
  warmed odds/games/props caches have ~5 min TTLs). Run command:
  `bash scripts/prebuild-cron.sh` (reads `PREBUILD_CRON_URL` defaulting to the
  published api-server, and `PREBUILD_CRON_KEY` falling back to
  `NOTIFY_CRON_KEY`). The endpoint makes the live instance warm its caches over
  loopback, so it adds no extra Odds API quota beyond a normal page load.

To set up the pre-warming schedule: from the published project, create a
**Scheduled Deployment** (Publishing tool) with run command
`bash scripts/prebuild-cron.sh` on a few-minute interval. `NOTIFY_CRON_KEY` is
already a shared env var, so no extra secret is required.

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
