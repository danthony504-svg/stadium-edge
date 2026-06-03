---
name: Mobile chat SSE stall → infinite spinner
description: Why the Expo AI Coach build spinner could hang forever, and the resilience pattern that fixes it
---

# Mobile chat SSE drop hangs the reader → infinite "Building your parlay…"

**Symptom:** mobile AI Coach build sticks on the spinner forever (Coach stays
mounted/visible, so it is NOT a component unmount/abort).

**Root cause:** the build holds an SSE `POST /api/chat` open ~10-15s while the
reasoning model (gpt-5.4) is silent before its first token. Through the Replit
proxy that connection is sometimes dropped a couple seconds in, BEFORE any token.
On native, `expo/fetch`'s `reader.read()` then **hangs forever instead of
rejecting** — so `streaming` never flips false. The server logs it as "request
aborted" ~2.3s in; it is intermittent (some builds complete in ~14s).

**Why:** a dropped TCP/proxy link does not reliably surface as a reader
rejection in expo/fetch; without a client-side liveness timeout nothing unwinds
the await.

**How to apply (the resilience pattern — keep it):**
- Client `streamChat` (lib/api.ts): per-attempt `AbortController` + a stall
  watchdog that calls `attemptCtrl.abort()` if NO chunk (incl. keep-alive
  comments) arrives within ~8s → forces the hung reader to reject. Auto-retry
  up to 3x BUT only while `sawContent === false` (retry after real tokens would
  duplicate output). Chain the caller's external `signal` so a genuine
  unmount/user-cancel aborts everything and is never retried (throw AbortError,
  which the coach catch ignores).
- Server `chat.ts`: keep-alive cadence must be tight enough that the client's
  stall window is safe — fire `: keep-alive` after >=3s idle (checked every
  ~1.5s), NOT the old >=10s. Comment frames are ignored by the client parser, so
  extra cadence never corrupts output even if it interleaves with tokens. This
  also helps the proxy not drop the idle connection.
- Invariant: client stall window MUST be comfortably larger than the server's
  max idle keep-alive gap, or healthy silent-reasoning phases false-trip the
  watchdog. Tune both together.
