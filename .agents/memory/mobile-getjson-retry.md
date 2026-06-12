---
name: Mobile getJson must retry transient failures
description: Why the Expo client's shared GET fetcher retries 429/5xx and how the retry is bounded
---

Mobile (`stadium-mobile/lib/api.ts`) `getJson` is the shared GET fetcher behind
`getOdds`/`getProps`/`getGames`/player-history/etc. It originally threw on the
FIRST non-2xx/timeout with **no retry**.

**Symptom:** Props page intermittently showed ErrorState ("Couldn't load live
data"). `fetchAllProps` calls `getOdds` **uncaught**, so one transient blip
blanked the whole page until the user tapped Retry. Per-game `getProps` failures
are individually caught, so only odds (or ALL props failing) throws.

**Why transient blips happen in prod:** the Replit edge makes every mobile
client look like ONE proxy IP, so the per-IP rate limiter can 429 under
aggregate load (see rate-limiter-false-429-pool-thinning.md); also brief
upstream 5xx and cold-autoscale timeouts. Dev/localhost never reproduces it
(single IP, warm server) — production logs show healthy 200s interspersed, which
is the tell that it's intermittent, not a deterministic bug.

**Fix / rule:** `getJson` retries with backoff+jitter:
- 429 + 5xx → retry up to MAX_ATTEMPTS (these return fast, cheap to retry).
- network drop / timeout → cap at ONE retry. Each waits the full per-request
  timeout (REQUEST_TIMEOUT_MS), and `getJson` is also used by buildChatContext
  fan-outs which have **no shared deadline** — stacking 3×12s would lengthen the
  "Building…" stall. (streamChat SSE has its own AbortController deadline; the
  context GET fan-outs do NOT.)
- deterministic 4xx (400/401/404) → fail fast, never retry.
- respect the abort signal (unmount/cancel) — never retry after a real abort.

**How to apply:** any new always-retry logic on this fetcher must keep the
network/timeout cap, or chat-context builds regress. Web (stadium-edge) already
had a 429 retry; this brought mobile to parity. Client-only change → needs
OTA/new build to reach installed apps (OTA is risky, see ota-update-unsafe-appversion.md).
