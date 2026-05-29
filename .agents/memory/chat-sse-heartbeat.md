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

**PRIMARY LATENCY FIX — `reasoning_effort`:** the dominant cause of "not loading"
was NOT the proxy idle abort, it was gpt-5.4's DEFAULT heavy reasoning. With the
big betting prompt, time-to-first-token was 35-80s of pure silent thinking (server
logs showed /api/chat completing at 80969ms, and the user's real request aborting
at 35060ms). Setting `reasoning_effort: "low"` on the `chat.completions.create`
call drops TTFB to ~1-3s (verified: 1 heartbeat then 231 data chunks through the
PUBLIC proxy). The picks come from the real-data context block and the rules are
explicit in the system prompt, so deep open-ended reasoning isn't needed. The
heartbeat is the belt-and-suspenders; `reasoning_effort` is what actually makes it
usable. esbuild (build.mjs) strips TS types so unknown SDK params compile fine, and
the upstream API accepts `reasoning_effort` for gpt-5.4. Bump to "medium" only if
pick quality regresses.

**TEST THROUGH THE PUBLIC PROXY, not localhost:** the client fetches `/api/chat`
with NO Vite proxy — it routes browser → Replit path-based proxy → api-server.
A `curl localhost:8080` bypasses that proxy and the gzip negotiation, so it can
look fine while the real browser path still fails. Always reproduce latency/abort
issues via `curl https://$REPLIT_DEV_DOMAIN/api/chat -H "Accept-Encoding: gzip"`.

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
