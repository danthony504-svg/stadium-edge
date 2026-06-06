---
name: ESPN odds fallback for The Odds API
description: When The Odds API runs out of credits, ESPN's per-event summary pickcenter[0] provides the same real DraftKings lines (h2h/spreads/totals). Iterate scoreboard, parallelize bounded, share cache with the live-card per-event route.
---

# Rule

ESPN's site API exposes real bookmaker odds inside the `summary?event={id}` endpoint at `pickcenter[0]` (DraftKings or whichever provider ESPN ships). When the paid odds feed is unavailable (401 / OUT_OF_USAGE_CREDITS / generic upstream error), iterate the scoreboard, parallel-fetch summary per event, and map pickcenter into the same `{id, sport, homeTeam, awayTeam, commenceTime, markets:[{key:"h2h"|"spreads"|"totals", outcomes:[{name, price, point}]}]}` shape the paid feed returns.

**CRITICAL — the fallback must be triggered SERVER-side, not by the client.** The primary `/sports/odds` route swallows the Odds API failure with a per-key `.catch(() => [])` and returns **HTTP 200 with `[]`**, NOT `!ok`. So the "client retries on `!ok`" design NEVER fires — the home "Upcoming" rail (built only from the odds feed), parlay builder, and chat Coach all silently go empty even though real games are on. Fix lives inside `/sports/odds`: when the assembled output is empty, self-call `/api/sports/odds-espn` then `/api/sports/odds-bovada` and return the first non-empty payload. Server-side ⇒ web AND the already-installed mobile app recover with a deploy, no client release/native rebuild. `GetOddsResponse` parses the fallback shape fine (`books` is optional, `point` nullish). Sports outside ESPN/Bovada coverage (tennis) just stay empty. Fallback is mains-only (no alt/period ladders during the outage — acceptable).

**Internal self-calls must bypass the per-IP rate limiter.** The fallback routes (`/sports/odds-espn`, `/sports/odds-bovada`) are IP-rate-limited, and ALL loopback self-calls share one `ip:127.0.0.1` bucket — under an outage every user request fans out through it and 429-collapses the fallback back to empty (exactly the failure we're fixing). Fix: `rateLimit` skips when `x-internal-call: 1` header is present AND `req.socket.remoteAddress` is loopback. Safe because the Replit edge overwrites X-Forwarded-For with the real (unspoofable) client IP, so external traffic can never appear as loopback; the header is only set by our own self-calls.

**Why:** Keeps the no-fake-data guarantee intact (only real bookmaker lines render) even during multi-day outages of the paid feed.

**How to apply / pitfalls:**
1. **Namespace cache keys.** A bulk-odds endpoint that fetches the scoreboard with no fallback must NOT share the same cache key as a primary scoreboard endpoint that has fallback logic — an empty-window response from the no-fallback fetcher will poison the other route. Use a distinct prefix (e.g., `scoreboard-odds:` vs `games:`).
2. **Share per-event cache with the single-event route.** Both the bulk fetcher and the per-event analyzer route should write the same `espn-odds:${path}:${eventId}` key with the same TTL (30s — live lines move fast). Otherwise the longer-TTL writer poisons the shorter-TTL reader.
3. **Bound concurrency.** Cold cache on a big MLB slate is 15-20 ESPN summary calls; cap to ~6 in flight to avoid tripping ESPN rate limits. A simple worker-pool over `Array.from({length: limit}, async () => { ... })` is sufficient — no need to pull in `p-limit`.
4. **Rate-limit the route.** A client retry storm after primary failure can hammer ESPN through the fallback; apply the existing per-IP `rateLimit` middleware.
5. **Filter finished games at the source.** Drop `state === "post"` events before fanning out — saves N summary calls and means the consumer doesn't have to re-filter.
6. **Skip per-market emission when any price is missing.** Never substitute a default like `-110` for a missing price — that violates the no-fake-data rule.
