---
name: Rate-limiter false-429 pool thinning
description: Why the parlay pool looked "thin" — per-IP limiter behind the proxy false-429'd the free fallback odds endpoints and silently dropped sports.
---

# Rate-limiter false-429 thins the betting pool

When a user reports "it couldn't build an N-leg parlay" / "pool too thin" and the
live slate should be richer than what showed, suspect the **rate limiter false-429ing
the free odds fallbacks**, not a genuine empty slate.

## The chain
- Client (`ParlayBuilder.tsx`) fetches odds via a 3-tier chain per sport:
  paid `/api/sports/odds` → free `/api/sports/odds-espn` → free `/api/sports/odds-bovada`.
- When the paid Odds API returns `[]` (offseason / no events — common), **every**
  selected sport cascades to BOTH free fallbacks.
- This fan-out runs in **two separate client effects** (live-mode effect + chat-context
  effect), each across all ~10 selected sports; React StrictMode doubles it again in dev.
- A `tryFetch` that hits HTTP 429 returned `null` → the sport silently resolved to `[]`
  and **dropped out of the pool** for that build.

## Two root causes (both fixed)
1. **Free fallback caps too low.** `/sports/odds-espn` and `/sports/odds-bovada` were
   capped at 30 req/min — far below a legit full-slate fan-out across two effects.
   Raised to 120. Safe because both are cached server-side via `cachedJson` (TTL), so
   the cap is only an abuse guard, not upstream protection.
2. **Limiter keyed by IP only, with one global bucket shared across ALL routes.**
   `rateLimit()` in `lib/sports.ts` used a single `rlBuckets` map keyed by `req.ip`.
   **Behind Replit's proxy `req.ip` collapses to one shared IP**, so the per-IP cap acted
   GLOBALLY — and worse, every route (odds, props, chat, weather...) shared the same
   bucket, so unrelated traffic burned the odds budget. Fixed by scoping the bucket key
   per-limiter: each `rateLimit()` call captures a unique `scope` id, bucket key =
   `${scope}:${ip}`.

**Why:** behind the proxy you cannot rely on per-IP isolation; a per-IP limiter is
effectively global, so caps must be generous AND scoped per-route or one busy endpoint
throttles another.

**How to apply:** before adding/lowering any `rateLimit` cap, remember every limited
route shares the proxy IP. Keep caps comfortably above the worst-case client fan-out
(sports × tiers × number of fetch effects × StrictMode). Client `tryFetch` chains now
retry ONCE on 429 with 400–1000ms jitter so a transient throttle self-heals instead of
dropping the sport — keep that retry when touching those chains (there are 4 tryFetch
chains in ParlayBuilder.tsx).

## Not yet done (architect follow-ups, lower priority)
- `cachedJson` has no in-flight promise coalescing, so concurrent cold misses still
  duplicate upstream fan-out (single-flight would help).
- Real client identity (trusted XFF / authed user id) instead of collapsed `req.ip`
  would make per-IP limits meaningful — skipped (needs proxy-trust config, riskier).
