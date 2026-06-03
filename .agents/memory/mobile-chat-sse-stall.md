---
name: Mobile chat SSE stall → infinite spinner
description: Why the Expo AI Coach build spinner could hang forever, and the resilience pattern that fixes it
---

# Mobile chat SSE drop hangs the reader → infinite "Building your parlay…"

**Symptom:** mobile AI Coach build sticks on the spinner forever (Coach stays
mounted/visible, so it is NOT a component unmount/abort).

**Root cause (TWO independent problems — both must be fixed):**
1. **Hung read.** The build holds an SSE `POST /api/chat` open ~10-15s while the
   reasoning model (gpt-5.4) is silent before its first token. Through the Replit
   proxy that connection is sometimes dropped before any token. On native,
   `expo/fetch`'s `reader.read()` **hangs forever instead of rejecting** when the
   socket is torn down. Server logs "request aborted" while the client `await`
   never settles → `streaming` never flips false → infinite spinner.
2. **First token loses the race.** Time-to-first-token with the full ~141k-char
   context EXCEEDS the connection lifetime (drop at ~4-7s). So even a healthy link
   often dies before the model's first token.

**Why the obvious fix fails:** an `AbortController` watchdog that calls
`attemptCtrl.abort()` does **NOT** unblock a hung native `reader.read()` — the
read stays pending, so the watchdog is useless. `abort()` DOES tear down the
socket (server sees "request aborted") but the JS promise never rejects.

**How to apply (the resilience pattern — keep it):**
- Client `streamChat` (lib/api.ts): **NEVER `await reader.read()` directly.**
  Race it against a stall timer: `Promise.race([reader.read(), stall])` where
  `stall` resolves a sentinel after `STALL_MS` (currently 4000). On stall:
  `attemptCtrl.abort()` to free the socket, then `throw` WITHOUT awaiting the
  orphaned read. This converts the infinite hang into a retry. Auto-retry up to
  `MAX_ATTEMPTS` (4) BUT only while `sawContent === false` (retry after real
  tokens would duplicate output). Chain the caller's external `signal` so a
  genuine unmount/user-cancel aborts everything and is never retried.
  - Orphaned reads are intentionally left unawaited (bounded by MAX_ATTEMPTS).
  - External cancel during a hung read is observed on the next stall tick (≤4s),
    not instantly — acceptable.
- Server `chat.ts`: keep-alive must keep the MAX idle gap WELL BELOW the
  proxy/device drop threshold AND fire densely enough to survive the silent
  pre-first-token window. Pings demonstrably EXTEND device connection lifetime
  (going 3s→1s cadence pushed it 2.6s→6.8s). Current cadence: fire after
  **>=400ms idle, checked every 250ms** (verified via curl: pings ~every 500ms).
  Always `res.write(PING)` once immediately to flush the stream open.
- Send the keep-alive as a REAL `data: {"ping":1}` frame, NOT an SSE `: comment`.
  A bare comment may be treated as ignorable by some intermediaries; a data frame
  reliably counts as on-the-wire activity. The client ignores any frame without a
  `.content` field, so pings never pollute the answer or PICK-line validation.
- **Invariant:** client `STALL_MS` MUST be comfortably larger than the server's
  max idle keep-alive gap (4000 ≫ ~0.65s), or healthy silent-reasoning phases
  false-trip the stall. Tune both together. **Verify through the proxy** with the
  device path — `curl -sN -X POST "$REPLIT_DEV_DOMAIN/api/chat"` and watch ping
  timing; an `identity` curl can mask the device-only hung-read behavior.

**There are THREE hang surfaces, not one — the hung-read fix alone is incomplete:**
1. The mid-stream `reader.read()` (above).
2. **The initial `expoFetch` itself** (waiting for response HEADERS) can also hang
   on a dead native link. Race it against a connect deadline (`CONNECT_MS`, 8000)
   using the SAME stall sentinel; on timeout `attemptCtrl.abort()` + throw — it
   lands in the pre-content retry path (safe: `sawContent` still false).
3. **Every plain GET in `buildChatContext`** (odds/games/props via `getJson`) runs
   while the spinner is already up, BEFORE the chat starts. A hung GET never
   rejects, so `Promise.all` deadlocks → spinner freezes with no `/api/chat` ever
   logged. Fix: `getJson` races both `expoFetch` and `res.json()` against
   `withTimeout` (REQUEST_TIMEOUT_MS, 12000). Callers already degrade on rejection
   (`.catch(()=>[])` / try-catch skip), so a timeout just narrows the pool — never
   fabricates. **When debugging "spinner forever", check the GET fan-out too, not
   only the SSE stream.**
