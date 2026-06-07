---
name: Chat StatMuse enrichment budget + speculative-skip
description: Why the chat enrichment wait is short and why bvp/pvt lookups only fire for NAMED players — don't re-widen them.
---

# Chat StatMuse enrichment: budget + speculative-skip

In `artifacts/api-server/src/routes/chat.ts` `buildChatContext`, the StatMuse
enrichment phase (team form, batter-vs-pitcher, player-career-vs-opponent,
period game logs, direct stat question) runs AFTER the base context is assembled
and BEFORE the model call, so it is pure time-to-first-token cost.

## Decisions (keep consistent)
- **Budget = 1800ms** (`STATMUSE_BUDGET_MS`), trimmed from 3000ms. A lookup that
  misses the deadline keeps running and warms the 10-min cache, so the same
  question on the FOLLOW-UP turn shows the fact. Per-fetch race, not all-or-nothing.
- **bvpFetches and pvtFetches fire ONLY for NAMED players.** They used to fall
  back to researching up to 6 ARBITRARY players from the pool when nobody was
  named (`named.length ? named : entries|cands`). That meant a generic
  "build me a parlay" (no player named) paid for ~6 speculative StatMuse round
  trips it never needed. Now: `for (const e of named)` / `named.slice(0,6)`.
  An empty array → `Promise.all([])` resolves instantly with no dangling timers.

**Why:** user explicitly chose "snappier — trim the stats wait and skip it when a
chat doesn't need it" over accuracy-first. A generic ticket build does not need
career-vs-opponent / batter-vs-pitcher lines for players it hasn't been asked
about; named asks still enrich fully. No fabrication risk — we only dropped
speculative fetches and shortened a best-effort wait, never invented data.

**How to apply:** do NOT re-add the `: entries` / `: cands` speculative fallback
to chase "more depth on generic builds" — that re-introduces the latency the user
asked to remove. teamFetches/questionFetch/periodLogFetches are already gated to
named-game / explicit-stat / period intent and are fine as-is.

## Already at the floor (don't re-investigate as a speed lever)
The model is `gpt-5.4` at `reasoning_effort: "minimal"` (lowest setting) with an
idle-aware SSE heartbeat — that was the biggest TTFT win and there is no lower
reasoning setting. Base odds/props pool is client-supplied; server only does
fresh-fetch fallbacks + this enrichment.
