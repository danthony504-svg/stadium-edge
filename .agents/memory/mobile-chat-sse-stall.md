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
- Server `chat.ts`: the keep-alive must keep the MAX idle gap BELOW the
  proxy/device drop threshold. The real-world drop happens at ~2.3-2.6s of idle
  — i.e. DURING the model's silent pre-first-token window, BEFORE a lazy 3s
  heartbeat ever fires. A >=3s-idle keep-alive was therefore useless and the
  spinner kept hanging. Fix: fire after >=1s idle, checked every 750ms
  (steady-state max gap ~1.5s, comfortably under ~2.3s). Drop times vary
  (2.6/3.6/4.3s) = multi-hop idle enforcement + buffering/scheduling jitter, not
  a single fixed timeout — so stay well under the MINIMUM, not the average.
- Send the keep-alive as a REAL `data: {"ping":1}` frame, NOT an SSE `: comment`.
  A bare comment may be treated as ignorable/no-op by some intermediaries; a data
  frame reliably counts as on-the-wire activity AND is read by the client to
  re-arm its watchdog. The client ignores any frame without a `.content` field,
  so pings never pollute the answer or PICK-line validation.
- Invariant: client stall window MUST be comfortably larger than the server's
  max idle keep-alive gap, or healthy silent-reasoning phases false-trip the
  watchdog. Tune both together. **Verify through the proxy with `Accept-Encoding:
  gzip`** — an `identity` curl masks the bug (streams fine); gzip clients hit the
  buffering/idle path the device actually uses.
