---
name: Coach false "board is empty"
description: Mobile AI Coach wrongly says no games tonight when slate is full — ROOT CAUSE is the "tonight" today-only filter emptying every pool late in the evening; a server 304/ETag bug was a real but secondary contributor
---

# Coach false "live board is empty"

Symptom: mobile AI Coach replies a *coherent* "I don't have tonight's live
game/odds board loaded — no games, odds, or props" while the backend slate is
actually full (verify with `curl /api/sports/odds?sport=mlb`).

## TRUE root cause (confirmed via dev api-server logs): the "today/tonight" filter

A "Build me a 6-leg parlay **for tonight**" ask sets `wantsTodayOnly(focalText)`
→ true (coach.tsx passes the user message as `focalText` to `buildChatContext`).
`buildChatContext` then restricts EVERY pool (odds, games, props) to games that
pass `startsTodayUpcoming` — future AND on the **device's LOCAL calendar day**.

Late in the evening that set is empty: tonight's games have already started
(`t <= now` → false) and the only games still posted in the feed are TOMORROW's
local date (≠ today → false). So today-only nuked all realOdds/realGames, which
cascaded to realProps and the histories → `chatCtx {realProps:0, realOdds:0,
realGames:0, contextChars:249}` (the tell-tale constant ~249). The stream then
SUCCEEDS but on an empty context, so the model honestly says the board is empty.
This is a CLIENT-side deterministic filter bug, not network/HTTP.

**Fix / rule:** `resolveTodayOnly(requested, candidateStartTimes)` (pure, in
`lib/slate.ts`) — when today-only is requested but NO candidate game qualifies as
today-and-upcoming, DROP the restriction and fall back to the normal next-48h
pickable window. Games keep their real `startsAt`, so nothing is fabricated; the
coach just stops hiding the only real games it has (tomorrow's slate). The
server prompt already pre-filters to the 48h window and labels today/tomorrow.
JS-only mobile change ⇒ OTA-unsafe, ships on the next native build.

**Why a pure module:** these slate helpers (`isPickable`, `startsTodayUpcoming`,
`wantsTodayOnly`, `resolveTodayOnly`) had to move OUT of `api.ts` into
`lib/slate.ts` because `api.ts` imports `expo/fetch` and won't load under
`node --test`. `api.ts` re-exports them so every `from "./api"` import is intact.
Test fixtures for these must anchor to the LOCAL calendar (e.g. "noon tomorrow",
"23:59 today") — raw `now + Nh` offsets are flaky because they cross local
midnight differently depending on what time the suite runs.

## Secondary (real but NOT the cause): server 304/ETag

Earlier the same symptom was (correctly) traced to Express auto-ETag: the Coach
re-fetches URLs other screens already cached, the server answered `304` with an
empty body, and the client `getJson` does `if (!res.ok) throw` (304 is not
`res.ok`) → empty pool. Fixed at the server (`artifacts/api-server/src/app.ts`):
`app.set("etag", false)` + a `/api` middleware setting `Cache-Control:
no-store`. This was a genuine bug worth keeping (live feeds must never be
client-cacheable), but it did NOT fix the reported failure on its own — even
with fresh 200s, today-only still emptied the pools. Keep both fixes.

**Why distinct** from `mobile-streamchat-resilience` ("couldn't reach feed" =
streamChat throwing pre-first-token): here the stream SUCCEEDS, the *context* is
empty. A coherent empty-board reply ⇒ context build returned empty pools, not a
stream failure.

## How to apply

Any future "coach says empty but data exists" report → (1) confirm backend has
games (`curl /api/sports/odds`); (2) check the dev api-server `chat context
size` / `chatCtx` log — if it shows `realOdds:0 realGames:0` with a constant
small `contextChars`, the CLIENT filtered everything out. If the ask contained
"today"/"tonight" and it's late local-evening, suspect today-only emptying the
pools first; if the context-build GETs are logging `304`, suspect HTTP caching.
Never let API JSON feeds be conditionally cacheable, and never let an intent
filter (today-only, sport/game focus) reduce a full slate to zero without a
graceful fallback.
