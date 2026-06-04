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
- `STALL_MS` (mid-stream gap) can stay ~4s because the server heartbeat writes a
  `data:{ping:1}` frame after >=400ms idle (interval checks every 250ms), so the
  client sees activity every ~400-650ms even during the model's silent
  time-to-first-token. The client resets its stall watchdog on ANY chunk.
- `CONNECT_MS` must cover body-upload + TTFB, not just TTFB. Raised 8s→12s.
- Backoff must be **abort-aware** (clear timer + resolve on the caller's signal)
  or a user cancel waits out the delay; and skipped after the final attempt.
- Leg count does NOT change the context (buildChatContext always uses
  DEFAULT_SPORTS, no threshold/periods unless asked), so "8 leg fails" is not
  leg-count-specific — same body/size as a 3-leg; it's pure network timing.
