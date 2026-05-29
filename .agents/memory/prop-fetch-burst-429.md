---
name: Prop-fetch empty realProps — two distinct causes
description: "chat not adding player props" / "0 strikeout props" has TWO independent root causes — the order-blind realProps slice(400) cap (PRIMARY for market-named requests) and the parallel-burst 429 drop (intermittent, cold-cache).
---

# PRIMARY root cause for "0 <market> props": the order-blind slice(400) cap

This is the cause that actually explained the reproducible "Can you build me a 5-leg
strikeout parlay → 0 pitcher strikeout props available" failure. The burst-429 fix below
did NOT fix it (the data WAS reaching the client; per-event `/api/sports/props` returned K
props fine). **Smoking gun in the server diagnostic: `realProps:0` but `playerHistory:40`
on the same send** — the props were dropped but their players survived.

**Mechanism:** in `ParlayBuilder.tsx`, the chat send builds `realProps` by walking
`mergedPropsByEvent = {...realPropsByEvent (cached, possibly other-sport), ...extraProps
(this send's fetches)}` at ~165 props/game, then hard-caps with `realProps.slice(0, 400)`
when assembling the context. Cached/other-sport games iterate FIRST (object spread key
order), so ~2.4 games front-load all 400 slots. The freshly-fetched `pitcher_strikeouts`
props land at array positions PAST 400 and get sliced off entirely. Meanwhile
`playerTargets` (→`playerHistory`) has its OWN independent `slice(0,40)` filled in the same
loop, so the pitchers still appear there — hence `realProps:0` + `playerHistory:40`. The
server then market-locks `realProps` down to ONLY `pitcher_strikeouts` (chat.ts
`MARKET_KEYWORDS`, exact-match `allowed.has(market)`) and sees an empty pool → AI honestly
reports "0 props". `wantsWideProps` makes it worse (uncaps `toFetch` to the whole ~23-game
slate → ~3800 props pushed through a 400 cap).

**Fix (client-only, Vite HMR — no api-server restart):** right before the `slice(0, 400)`,
detect the user's requested market by mirroring the server `MARKET_KEYWORDS` regex map
VERBATIM (first-match-wins, combos before singles) into a client `PROP_MARKET_KEYWORDS`,
then stable-partition `realProps` into [requested-market head, everything-else tail] so the
requested props can never be sliced off. Gated to only reorder when a keyword matches, so
generic parlays are unchanged. Suffix matching is PERIOD variants only
(`_(q1..q4|h1|h2)$`), NOT a bare `startsWith(base+"_")` — the latter would let
`player_points` pull in `player_points_rebounds/_assists` combos the server lock drops
anyway (`_alternate` rungs are already folded into the base key server-side). Verified by
simulation: front-loaded pool of 2970 props / 75 K → OLD slice=0 K, NEW slice=75 K.
**Residual (acceptable):** if a SINGLE requested market itself exceeds 400 props, the cap
can still trim it — not a real-world concern at current slate sizes.
**Drift risk:** client `PROP_MARKET_KEYWORDS` and server `MARKET_KEYWORDS` must stay in
sync; a new prop market added to the server lock should be mirrored here too.

---

# SECONDARY (intermittent) cause: Prop-fetch parallel-burst 429 silently drops props

When a chat parlay is built, the client fetches `/api/sports/props` for up to several games
(`totalCap`: 6 normal / 12 props / 999 wide-props) in a burst. That burst can briefly trip the
**upstream Odds API** rate limit (429) or hit a transient 502. The original code did
`if (!r.ok) return;` — a single non-OK response **silently dropped that game's props for the WHOLE
send**, leaving `realProps` empty for the named game, so the AI could only build game-level legs.
This is the real mechanism behind intermittent "chat is still not adding player props" reports.

**The wide-props amplifier (e.g. "5-leg strikeout parlay"):** `wantsWideProps` (HR / strikeouts /
anytime-TD / goal-scorer) uncaps `perSportCap`/`totalCap` to 999, so `toFetch` becomes the WHOLE
in-window slate (~28 MLB games on a busy night). Each `/api/sports/props` fans out to ~3 upstream
Odds API calls (base + quarter/half + alt), so an unbounded `Promise.all` fired ~80+ simultaneous
upstream calls and reliably collapsed under upstream throttling on a COLD cache → most games empty
→ `realProps` empty → AI honestly reports "0 pitcher strikeout props available". On a WARM cache the
same burst succeeds (server `cachedJson`, 5-min TTL), which is exactly why the failure is
INTERMITTENT. NOTE: `cachedJson` has NO in-flight coalescing, so concurrent cold requests for
distinct event keys all hit upstream — nothing absorbs the stampede server-side.

**Why it looked like a deeper bug but wasn't:** the entire downstream pipeline is correct. When
props actually REACH the AI, they flow through end-to-end — prompt mandate (chat.ts) → server
named-game trim → client PICK parse → `filterPicksToReal` (validates by GAME label only, so a prop
survives whenever its game is in the 48h pool) → snapshot card renders each prop row with a "+ Add"
button → `addLeg(pick, {skipValidation:true})`. Proven via a real-data harness: realProps=657
reached the model and the AI returned 6/8 prop legs. So never chase the parse/validate/render layers
for this symptom — it's almost always **props not reaching the AI** (empty `realProps`).

**How to apply / verify:**
- The api-server diagnostic `"chat context size before model call"` logs `realProps`/`realOdds`/
  `realGames` counts per send. If a real failure shows `realProps: 0`, the issue is the client
  fetch (this file), NOT the AI. If `realProps > 0` but no prop legs, look at prompt/parse instead.
- api-server has NO watcher — restart it to pick up route/diagnostic edits (see api-server-no-watcher.md).
- The fix is TWO layers, both needed: (1) a bounded **concurrency pool** caps how many per-event
  fetches run at once (`PROP_FETCH_CONCURRENCY=5` workers pull from a shared index over `toFetch`),
  so a wide-props slate never fires the whole burst — this is what prevents the cold-cache upstream
  stampede in the first place; `toFetch` is named-first and workers pull in order, so named-game
  props are still fetched first. (2) a bounded **retry** around each per-event fetch — named games
  get more attempts, retry ONLY on 429/5xx (other 4xx = real "no props for this event", break
  immediately), jittered exponential backoff so retries don't re-burst in lockstep.
  **Why both:** retry alone still let ~28 games hit upstream simultaneously and exhaust attempts
  under a true flood; the concurrency cap lowers peak upstream load so the server cache warms
  steadily and later waves hit cache instead of upstream.
- Empty responses are deliberately NOT cached (`props.length > 0` gate), so a failed send doesn't
  poison the cache — the next send retries. The retry just recovers props WITHIN the same send.

**Distinct 429 sources (don't confuse them):** the per-route `rateLimit` middleware (client→server,
props is 120/min) vs. the upstream Odds API quota (server→Odds API). The props route maps upstream
non-OK to a **502** (throws in catch), NOT a 429. Other endpoints (odds-espn, odds-bovada, athletes)
have their own lower middleware caps and DO emit 429 — those are unrelated to missing props.
