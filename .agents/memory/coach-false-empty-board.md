---
name: Coach false "board is empty"
description: Mobile AI Coach wrongly says no games tonight when slate is full — transient context-fetch failure, not an empty slate
---

# Coach false "live board is empty"

Symptom: mobile AI Coach replies a *coherent* "the live board I'm seeing right
now is empty — no posted games, odds, or props for tonight" while the backend
slate is actually full (verify with `curl /api/sports/odds?sport=mlb`).

**Root cause:** the chat POST itself succeeds (so you get a fluent reply), but
the CLIENT-built context pools came back empty. `buildChatContext` fans out
`getOdds`/`getGames`/`getInjuries` across ~12 sports = ~36 SIMULTANEOUS requests,
each wrapped in `.catch(() => [])` with a 12s per-request timeout. On a
constrained uplink (congested cell / iOS Low Power Mode — screenshots showed low
battery) that burst SATURATES the link, so every request races and loses the
timeout, degrading every pool to empty. The lone chat POST succeeds because it
fires AFTER the burst, with no contention. NOT a rate-limit issue here (prod
logs showed zero 429s); it's connection saturation. The model then honestly but
wrongly reports no games.

**Why this is distinct** from `mobile-streamchat-resilience` ("couldn't reach
feed" = streamChat throwing pre-first-token): here the stream SUCCEEDS, the
*context* is empty. A coherent empty-board reply ⇒ context build failed, not the
stream.

**Fix / rule:** both core pools (odds AND games) coming back globally empty is
the signature of a transient fetch failure — an in-season night ALWAYS has at
least one posted game, so empty is never real. Detect it
(`!anyNonEmpty(oddsAll) && !anyNonEmpty(gamesAll)`) and retry the core feeds
ONCE after a ~600ms pause before accepting empty. CRITICAL: the retry must be
SEQUENTIAL (one sport at a time), not another parallel burst — a parallel retry
re-saturates the same constrained link and fails identically. Sequential gives
each request the full pipe so it completes. Keep the FIRST attempt parallel
(fast path for good connections); sequential is only the fallback. Still
fail-closed: if truly empty after retry, proceed honestly.

**How to apply:** any future "coach says empty but data exists" report → confirm
backend has games, then this is the client context build. The retry lives in
`buildChatContext` (api.ts). JS-only mobile change → OTA-unsafe, ships next
native build.
