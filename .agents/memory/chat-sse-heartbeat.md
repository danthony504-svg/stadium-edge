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

# Heartbeat must cover MID-STREAM pauses, not just time-to-first-token

A later "asked for 3 HR picks, got 1, and it showed the raw market key
`batter_home_runs`" report was the SAME proxy-idle-abort class as TTFB, but in a
DIFFERENT window. The heartbeat used to call `stopHeartbeat()` on the FIRST real
token ("no more keep-alives needed") — assuming once tokens flow they keep the
socket warm. False for a reasoning model: gpt-5.4 goes SILENT again mid-stream
while composing the next leg's EDGE note, so a >~30s gap BETWEEN picks lets the
proxy kill the connection. The stream is truncated to one PICK line and the
client never receives the rest.

The raw-key symptom is the tell that it's a TRUNCATION, not a bad answer: the
client renders a COMPLETE `PICK: … | market | … | +odds` line as a prettified
card (`friendlyMarketLabel` → "Home Runs"); a line is only shown as raw prose
text while it's still INCOMPLETE (no trailing price yet). So "user sees raw
`batter_home_runs` and only 1 leg" == the stream died mid-leg, card-parsing never
completed. The backend itself returns all 3 picks fine (verify by POSTing the
same body to localhost:8080 — full 3-pick stream comes back).

**Fix (two parts):**
- Server: keep the heartbeat running for the WHOLE stream, IDLE-AWARE. Track
  `lastActivity = Date.now()` updated on every `data:` write; the interval (poll
  ~5s) emits `: keep-alive` only when `Date.now() - lastActivity >= 10000`. So it
  fires during real idle gaps (before first token AND between picks) but never
  interleaves with active token flow. Do NOT `stopHeartbeat()` on first token —
  only on stream end / error / `res.on("close")`.
- Client: in the assistant-message prose fallback, `return null` for any line
  matching `/^\s*\**\s*PICK\s*\**\s*:/i`. Complete PICK lines are already
  intercepted into cards earlier, so any PICK line reaching the prose path is a
  half-streamed leg — hiding it stops the raw market key from flashing (or from
  sticking if a stream stalls mid-leg).

**Why:** streaming only defeats the proxy idle timeout while bytes flow; a
reasoning model emits zero bytes during BOTH its prefill think and its
between-output think, so the keep-alive must span the entire response, not stop
at first token.

# "curl works, browser shows nothing" — proxy buffering + invisible heartbeat

A later "Still nothing" report had a different root cause than TTFB. Server logs
showed `POST /api/chat` reaching the server, headers out (200), then `request
aborted` at ~18s — and there is NO client-side AbortController/timeout, so that
abort is the USER giving up on a blank bubble. Two compounding causes:
1. The `: keep-alive` heartbeat is an SSE COMMENT; the client loop ignores any
   chunk not starting with `data: `, so it keeps the socket alive but renders
   NOTHING. The user sees a blank bubble for the whole 12-18s time-to-first-token.
2. The Replit path-based proxy BUFFERS the whole SSE stream to GZIP-compress it
   whenever the client sends `Accept-Encoding: gzip` — which every real browser
   does — and flushes nothing until the connection ends. A `curl`/node test with
   `Accept-Encoding: identity` streams fine and MASKS the bug, so "works in curl,
   blank in browser" is the tell. MEASURED: identity → first status 0.14s; gzip →
   nothing for 90s+ (request then "aborted" = user gave up).

**Fix — `Cache-Control: no-transform` is the one that actually works:**
- `res.setHeader("Cache-Control", "no-cache, no-transform")` — `no-transform` is
  the HTTP-standard directive forbidding intermediaries from compressing/transforming
  the body. THIS is what stops the proxy buffering. `X-Accel-Buffering: no` alone
  did NOT fix it (it's nginx-family and the Replit proxy ignored it for gzip clients).
  Keep `X-Accel-Buffering: no` too as belt-and-braces, but no-transform is the fix.
- Emit a ~2KB comment-padding burst (`:` + spaces + `\n\n`) immediately after
  `flushHeaders()` — exceeds any minimum-buffer threshold and forces an instant flush.
- Emit ONE real `data:` event right after (a `{status:"…"}` line), not just the
  comment heartbeat, so the bubble paints instant feedback during the silent TTFB.
  Client shows it transiently and OVERWRITES it with the first real token (guard the
  status branch on `!fullText`); keep `fullText` built only from `data.content` so
  the status never enters PICK-line validation.
- Client fallback: if the stream ends with empty `fullText`, replace the transient
  status with a retry message — otherwise an empty/errored stream leaves the bubble
  stuck on "…" forever (looks identical to the original "nothing loaded" bug).

**Why:** the proxy buffers in order to gzip; only `no-transform` tells it to stop.
keep-alive comments solve the proxy IDLE timeout but not BUFFERING and give zero
visible feedback. After the fix, gzip clients get first status at 0.17s and first
real token ~5-6s (with `reasoning_effort:"minimal"`).

**How to test:** ALWAYS test with `Accept-Encoding: gzip` (identity masks the bug).
Confirm the first `data:` chunk lands sub-second through the PUBLIC `$REPLIT_DEV_DOMAIN`
proxy, not just localhost.

# Named-game context trim — cut prefill when every leg is locked to one matchup

Single-game parlay requests ("Spurs @ Thunder, 10 legs") still carried the FULL
client context (up to 400 props + 120 odds + per-player playerHistory across ALL
games). Prefill over that huge block is a second TTFB driver on top of reasoning.
After the lockedMarket/periodIntent/sameGameIntent branches and BEFORE the
`JSON.stringify(lockedContext)` serialization, detect game label(s) whose BOTH team
nicknames appear in the latest user message and filter realProps/realOdds/realGames/
playerHistory/matchupHistory down to only the named game(s). Measured effect:
single-game TTFB dropped to ~12-13s (from 30-90s) with `reasoning_effort:"low"`.

**Why:** when the user names ONE game, every leg is game-locked to it anyway (see
single-game-request-lock.md), so the other ~19 games' data is dead prefill weight.
A generic "build me a parlay" names no game → keep full cross-game variety.

**How to apply / gotchas:**
- Gate the trim on `namedLabels.size > 0 && namedLabels.size < allLabels.size` so a
  generic request (0 named) and an all-games-named request both fall through untouched.
- Match nicknames with WORD BOUNDARIES (`\b<escaped>\b`, case-insensitive), NOT raw
  `includes()` — common-word nicknames ("Heat", "Magic", "City", "Kings") fire on
  incidental substrings otherwise. Require BOTH sides' nicknames for a label to count.
- FAIL OPEN: only apply the trim when it still leaves usable data
  (`trimmedProps.length > 0 || trimmedOdds.length > 0`). A label-format mismatch that
  wipes both would otherwise starve the model into a false "no data" answer — keep the
  full context instead.
- playerHistory is keyed `"Player Name#athleteId"`; retain entries whose display name
  (value `.player` or the key before `#`, lowercased) is still in the trimmed props.
  matchupHistory is keyed by the exact `"Away @ Home"` label.
