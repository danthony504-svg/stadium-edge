---
name: Coach false "board is empty"
description: Mobile AI Coach wrongly says no games tonight when slate is full — server 304s discarded by the client, not an empty slate
---

# Coach false "live board is empty"

Symptom: mobile AI Coach replies a *coherent* "the live board I'm seeing right
now is empty — no posted games, odds, or props for tonight" while the backend
slate is actually full (verify with `curl /api/sports/odds?sport=mlb`).

**Root cause (confirmed via dev api-server logs):** the chat POST itself
succeeds (fluent reply), but the CLIENT-built context pools came back empty.
`buildChatContext` re-fetches `getOdds`/`getGames`/`getInjuries` across ~12
sports. The dev logs showed those requests SUCCEEDING server-side — most as
**`304 Not Modified`**, a few `200` — yet the chat POST that followed logged
`realProps:0, realOdds:0, realGames:0`. The bug: Express auto-generates a weak
**ETag** on every JSON response; on native, `expo/fetch` revalidates a URL an
earlier screen (Home/Props) already cached and the server answers **304 with an
EMPTY body**. The mobile client's `getJson` does `if (!res.ok) throw` — and
`res.ok` is FALSE for 304 — so every 304 throws and degrades to its
`.catch(() => [])` empty pool. Deterministic, and specific to the Coach because
it is the SECOND fetch of data the other screens already cached (first fetch =
200 with body, shows fine; re-fetch = 304, discarded).

**NOT network saturation / not 429.** An earlier theory blamed ~36 parallel
fetches saturating a weak uplink (low-battery screenshots). That was wrong: the
logs prove the requests completed server-side. The saturation "sequential retry
once when both pools globally empty" landed in `buildChatContext` is harmless
belt-and-braces but does NOT fix this — a retry just gets another 304.

**Why distinct** from `mobile-streamchat-resilience` ("couldn't reach feed" =
streamChat throwing pre-first-token): here the stream SUCCEEDS, the *context* is
empty. A coherent empty-board reply ⇒ context build failed, not the stream.

**Fix / rule:** kill the 304s at the SERVER (`artifacts/api-server/src/app.ts`):
`app.set("etag", false)` + a `/api` middleware setting `Cache-Control: no-store`.
Every request then returns a fresh `200` with a body; live odds must never be
served from a stale client cache anyway, and the server keeps its own in-memory
`cachedJson` so upstream provider load is unaffected. Server-side is the right
layer: it fixes web + mobile + the ALREADY-PUBLISHED mobile app on the next API
deploy with NO native rebuild (the client `getJson` non-2xx-throws is fine once
304 never arrives). Verify: `curl -D-` shows no `ETag` + `Cache-Control:
no-store`, and `curl -H 'If-None-Match: "x"'` returns 200 not 304.

**How to apply:** any future "coach says empty but data exists" report → confirm
backend has games (curl), then check the dev api-server logs for the
context-build burst; if those GETs are 304/200 but the following `chat context
size` log shows zeros, it's HTTP caching surfacing as discarded 304s, not the
network. Never let API JSON feeds be conditionally cacheable.
