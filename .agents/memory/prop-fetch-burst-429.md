---
name: Prop-fetch parallel-burst 429 drop
description: Why "chat not adding player props" can be intermittent — the client prop fetch burst trips upstream rate limits and silently drops the named game's props for that send.
---

# Prop-fetch parallel-burst 429 silently drops props

When a chat parlay is built, the client fetches `/api/sports/props` for up to several games
(`totalCap`: 6 normal / 12 props / 999 wide-props) in ONE parallel `Promise.all` burst. That
burst can briefly trip the **upstream Odds API** rate limit (429) or hit a transient 502. The
original code did `if (!r.ok) return;` — a single non-OK response **silently dropped that game's
props for the WHOLE send**, leaving `realProps` empty for the named game, so the AI could only
build game-level legs. This is the real mechanism behind intermittent "chat is still not adding
player props" reports.

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
- The fix: bounded retry loop around the per-event fetch — named games get more attempts, retry
  ONLY on 429/5xx (other 4xx = real "no props for this event", break immediately), jittered
  exponential backoff so retries don't re-burst in lockstep and re-trip the same limit.
- Empty responses are deliberately NOT cached (`props.length > 0` gate), so a failed send doesn't
  poison the cache — the next send retries. The retry just recovers props WITHIN the same send.

**Distinct 429 sources (don't confuse them):** the per-route `rateLimit` middleware (client→server,
props is 120/min) vs. the upstream Odds API quota (server→Odds API). The props route maps upstream
non-OK to a **502** (throws in catch), NOT a 429. Other endpoints (odds-espn, odds-bovada, athletes)
have their own lower middleware caps and DO emit 429 — those are unrelated to missing props.
