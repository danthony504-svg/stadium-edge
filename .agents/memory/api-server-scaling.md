---
name: api-server scaling (per-user limits + Redis store)
description: How api-server rate limits became per-user and how to run multiple instances; the non-obvious Replit edge-proxy XFF behavior.
---

# Per-user rate limits + horizontal-scaling store

## Replit edge proxy sanitizes X-Forwarded-For (the key durable fact)
Behind Replit's edge, a request's `X-Forwarded-For` looks like
`<realClientIP>, <internal 10.x hops...>, 127.0.0.1`. The edge **overwrites the
leftmost entry with the real connecting IP** — a client-supplied
`X-Forwarded-For: 1.2.3.4` is DROPPED, not prepended. Verified by sending a
spoofed XFF externally and seeing `req.ip` stay the real IP.

**Why it matters:** `app.set("trust proxy", true)` is therefore SAFE here —
`req.ip` = real, non-spoofable client IP. Without trust proxy, every request
shares the proxy socket IP (`::ffff:127.0.0.1`) and per-IP limits collapse to a
single GLOBAL bucket. (Don't "fix" this by switching to a fixed hop count; the
internal hop count is not stable and `true` already reads the right address.)

## Rate-limit identity
Limiters key on Clerk `getAuth(req).userId` (`u:<id>`) when signed in, else
`ip:<req.ip>`. getAuth can throw if clerkMiddleware hasn't run — wrap in
try/catch and fall back to IP.

## Shared store (lib/store.ts) — opt-in Redis, in-memory default
`cacheGet/cacheSet` + `rateLimitHit` live in `lib/store.ts`. With no `REDIS_URL`
they use in-process Maps (exact old behavior). Set `REDIS_URL` to share state
across instances. No managed Redis integration exists on Replit — user supplies
an external URL (Upstash/Redis Cloud). `cachedJson`/`rateLimit` in `sports.ts`
delegate here; `statmuse.ts` rides on `cachedJson` (no separate cache).

**Rules learned:**
- Redis errors must FALL THROUGH to the in-memory path (degraded, per-instance),
  not just fail-open/disable limiting — keep one limiter alive during an outage.
- Redis sliding window must be ONE atomic Lua script
  (`ZREMRANGEBYSCORE`→`ZCARD`→conditional `ZADD`+`PEXPIRE`) to preserve
  "allow `max`, reject `max+1` without consuming a slot" under concurrency.
- `rateLimit({windowMs,max,name})` — `name` is the Redis bucket scope and MUST
  be a stable explicit string per limiter. Ordinal/auto scopes (`rl0`,`rl1`…)
  fragment buckets across mixed-version rollouts.

## Verify
api-server has no watcher — restart the workflow after edits. Smoke test on
`localhost:8080`: burst `POST /api/slip-image` (max 30) → first 30 pass, rest 429.
