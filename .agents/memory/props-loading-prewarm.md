---
name: Props tab loading speedup (SWR + load-more + server prewarm)
description: How Stadium Edge Props tab loads instantly and how server caches are pre-warmed on a schedule.
---

# Props tab instant-load + load-more (mobile)

- `props.tsx` per-sport query data shape is `{ games, total }` (NOT a bare array). Every consumer reads `q.data?.games ?? []`; `total` drives load-more.
- Instant-from-cache = AsyncStorage snapshot (`lib/propsCache.ts`) fed as React Query `placeholderData` + long `gcTime`; blocking spinner only on a true cold start (no snapshot). Snapshots are freshness-capped (30 min) and size-bounded (first 12 games) so a stale slate never shows as live and the blob can't grow with load-more.
- Load-more replaced the old fixed `MAX_GAMES=12`: `INITIAL_GAMES`/`GAMES_STEP`, `gamesLimit` state grows on scroll-near-bottom; `fetchAllProps(sport, limit)` slices the sorted pickable window to `limit`.

# Server cache pre-warming (api-server)

- `lib/prebuildJobs.ts` `runPrebuildJobs()` warms the SAME caches the app reads (`/sports/odds`, `/sports/games`, soonest ~8 upcoming games' `/sports/props`) for every PROPS sport (`Object.keys(MARKETS_BY_SPORT)`).
- Warm calls go over LOOPBACK with header `x-internal-call: 1` — that + loopback origin bypasses the per-IP rate limiter (see `rateLimit` in `lib/sports.ts`), so our own burst never 429s. Bounded concurrency + stagger + 429/5xx backoff keep upstream pressure under the Odds API per-second limit.
- Endpoint `POST /api/prebuild/cron` (route `routes/prebuild.ts`) is guarded by `x-cron-key` == `PREBUILD_CRON_KEY || NOTIFY_CRON_KEY` (mirrors notifications cron). 

**Why:** api-server deploys AUTOSCALE, so a background `setInterval` can't be trusted — a **Scheduled Deployment** must hit the cron endpoint, exactly like the existing notifications cron. The endpoint existing is NOT enough; without a scheduled job pointed at it, caches are never pre-warmed in prod.

**How to apply:** adding a props sport in `MARKETS_BY_SPORT` auto-warms it. Restart the api-server workflow after edits (one-shot build+start, no hot reload). Verify by POSTing the cron endpoint with the key and checking the `{summary, perSport}` tally + no 429s in logs.
