---
name: Chat SSE heartbeat for reasoning-model TTFB
description: Why large-context parlays returned "nothing loaded" — reasoning model is silent for ~30s before first token and the proxy kills the idle SSE connection
---

# Reasoning-model TTFB can exceed the proxy idle timeout — SSE needs a heartbeat

`/api/chat` streams via SSE from `gpt-5.4`, a REASONING model. It can spend
20-40s on internal reasoning BEFORE emitting its first visible token, especially
when the context block is large (e.g. a single-game parlay carrying deep
period markets + a full props list). During that silent window NO bytes are
written to the response, the Replit proxy in front of the app sees an idle
connection and aborts it around ~30s. The user sees "nothing loaded" / the
request never returns, even though the model is still working. Server log shows
`request aborted ... responseTime ~28000-29000` with NO error — the client/proxy
closed the socket mid-await, not an LLM failure.

**Why:** streaming only keeps a proxy connection alive if bytes flow. A reasoning
model produces zero output bytes during its think phase, so a big enough prompt
pushes time-to-first-token past the idle limit.

**How to apply:**
- After `res.flushHeaders()`, write an SSE COMMENT heartbeat (`": keep-alive\n\n"`)
  immediately and on a ~10s interval until the first real token arrives; clear it
  on first content, on stream end, on error, and on `req.on("close")`.
- SSE comment lines are safe: the client loop ignores any chunk not starting with
  `data: `, so heartbeats never corrupt output.
- This is the robust fix — prefer it over merely shrinking context. Enlarging the
  chat context (more markets/props) is fine for quality but RAISES TTFB, so the
  heartbeat must exist whenever this model streams.
- A client-side fetch with no AbortController will still surface the proxy abort as
  a failed/empty stream; the heartbeat is what actually prevents the abort.
- To cancel the upstream model call on client disconnect, listen on `res.on("close")`,
  NOT `req.on("close")`. For a POST, Node fires the REQUEST stream's "close" as soon
  as the body is read (almost immediately) — wiring an abort to it kills EVERY call
  before the first token (symptom: exactly 1 heartbeat, 0 data chunks, no error
  logged). `res` "close" fires on real socket teardown; treat it as a disconnect
  only when `!res.writableEnded` (otherwise it's the normal post-`res.end()` close).
  Pass the AbortController's signal as the 2nd arg to `client.chat.completions.create`.
