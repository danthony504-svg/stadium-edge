---
name: Odds API per-second freq limit → multi-key soccer 502
description: Why soccer props vanish under burst and why upstream Odds API fetches must retry
---

The Odds API enforces a per-SECOND frequency limit (`EXCEEDED_FREQ_LIMIT`, HTTP
429) that is SEPARATE from the monthly quota. It is not our own rate limiter — it
comes back as `Upstream 429` from the API itself.

**Symptom:** the AI Coach honestly-but-wrongly refuses a soccer prop build ("no
soccer player props posted") even though props exist upstream. Reproduces only
under BURST: when the client's chat-context build fires ~15 concurrent
`/sports/props` fetches, SOCCER specifically returns 502 with 0 props while every
single-key sport returns 200. Fetched standalone, soccer returns 800+ props.

**Why soccer is the victim:** soccer is MULTI-KEY, so a single soccer props
request first fans out to several league events-list lookups (`fetchEvents` per
league) to resolve which league owns the event, THEN does the props fetch. That
extra fan-out pushes soccer over the per-second limit before single-key sports,
which do no fan-out.

**The trap:** the base props fetch (`fetchOdds`, `Promise.all` index 0) had NO
retry/catch (unlike the qh/alt sibling fetches which swallow to null), so a
transient 429 THREW → the route's outer catch returned 502 → client got empty
soccer props → `realProps` had zero soccer entries → model refused. Variant test
confirmed: props IN context → clean 5-leg soccer parlay; props ABSENT → the exact
user refusal. So the bug is context-delivery, never the prompt.

**Fix (the rule):** any upstream Odds API fetch MUST retry transient failures
(429 + 5xx) with bounded backoff + JITTER, and FAIL FAST on 4xx like 422
(unsupported market). The freq window is sub-second, so ~200/400/800ms (+jitter,
4 attempts) rides it out; success is cached 5 min so only the cold burst pays.
Jitter de-syncs concurrent retries. Implemented as `fetchOddsApi(url, attempts)`
in props.ts, wired into BOTH `fetchOdds` and `fetchEvents`.

**Why:** without retry, the heaviest (multi-key) sport silently starves under the
exact concurrency the app generates on every Coach build. Honesty pressure then
turns a transient infra hiccup into a confident-sounding refusal.

**How to apply:** when adding a new multi-key sport or any new upstream Odds API
call path, route it through a retrying fetch — never a bare `fetch` whose throw
becomes a 502. Verify with a concurrent-burst script across the full slate
(cold cache), not a standalone single-sport fetch (which hides the limit).
