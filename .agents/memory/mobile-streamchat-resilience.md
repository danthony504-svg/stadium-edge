---
name: Mobile coach "couldn't reach the feed" = streamChat retry exhaustion
description: Where to look when the mobile AI Coach build fails with a generic feed/connection error, and the retry-tuning constraints.
---

The mobile coach's generic build-failure message (coach.tsx catch around the
buildChatContext+streamChat block) fires for ANY non-abort throw, so the wording
("couldn't reach the live data feed" / "lost the connection") does NOT pinpoint
the cause. To localize:

- `buildChatContext` (stadium-mobile/lib/api.ts) is fully resilient — every layer
  is `.catch`'d to empty: per-sport getOdds/getGames, buildMatchupHistoryAndUpsets
  (per-target try/catch), UFC getFightAnalysis (returns null on throw), and the
  props loop (per-game try/catch). An all-feeds-down build returns an EMPTY context,
  it does NOT throw — and the server then streams an HONEST "I can't build a real
  parlay" (visible text), which is a different outcome than the catch message.
- Therefore the generic catch almost always means **`streamChat` threw before the
  first token** (exhausted all retry attempts). Look there, not at the data feed.

**Why the weak-LTE failures happened:** streamChat retried with NO backoff (all
attempts burned in milliseconds, so a brief blip killed every attempt before the
link recovered) and `CONNECT_MS` was too tight to UPLOAD the large POST body (the
full real-data context — ~120 odds + prop pool + matchup/fight analysis = tens of
KB) over a weak uplink before headers arrive.

**Retry-tuning constraints (don't relax blindly):**
- The stall watchdog is **TWO-PHASE**, NOT a single STALL_MS. CORRECTION to an
  earlier belief: server keep-alive pings do **NOT** reach the client during the
  model's pre-first-token window — the Replit proxy buffers the WHOLE response
  (status + props + every ping, even 2KB-padded) until the upstream emits its
  first real content. So a flat 4s STALL_MS tripped on EVERY attempt before a big
  build could start → "I lost the connection while building your ticket". See
  chat-sse-heartbeat.md ("proxy buffers EVERYTHING until first token").
- Fix: `FIRST_TOKEN_MS` (~45s) for reads taken while `sawContent === false`
  (covers worst-case reasoning + proxy buffering, during which the client legit
  receives zero bytes), then tighten to `STALL_MS` (~4s) once the first token
  lands — AFTER first token the proxy is pass-through and frames/pings DO flow in
  real-time, so a 4s gap then is a real drop. Retry safety preserved: still
  `!sawContent` during the long wait, so a genuine pre-token death still retries.
- `CONNECT_MS` must cover body-upload + TTFB, not just TTFB. Raised 8s→12s.
- Backoff must be **abort-aware** (clear timer + resolve on the caller's signal)
  or a user cancel waits out the delay; and skipped after the final attempt.
- Leg count does NOT change the context (buildChatContext always uses
  DEFAULT_SPORTS, no threshold/periods unless asked), so "8 leg fails" is not
  leg-count-specific — same body/size as a 3-leg; it's pure network timing.
