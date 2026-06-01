---
name: Market-lock starvation backfill
description: Why non-period single-market chat locks need their own server-side fresh-fetch fallback, mirroring the period branch.
---

# Market-lock starvation → server-side backfill

When the user names a single prop market ("3 players to hit a home run", "anytime
TD", etc.), chat.ts MARKET-LOCK filters `context.realProps` down to just that
market's keys. The client's `realProps` is capped (~400) and built in
**nondeterministic worker order**, so a single-market lock can be starved to 0-1
entries even when the live book offers many — the AI then returns 1 pick when the
user asked for N. The count/multi-pick prompt logic is fine; it's data starvation.

**Rule:** every market-lock branch that filters realProps to one market needs a
server-side fresh-fetch fallback. The PERIOD branch already had one; the
NON-period branch did not — add/keep one there too.

**How to apply (non-period branch):**
- Trigger only when the locked pool has `< 5` distinct players (cheap, avoids
  fetching when the client already sent enough).
- `MARKETS_BY_SPORT` is `export`ed from `routes/props.ts` — the single source of
  truth for which sport's props feed carries which market. Import it into chat.ts.
  `props.ts` does not import chat.ts, so no circular import.
- supportSports = sports whose `MARKETS_BY_SPORT[sport]` includes any locked
  market (e.g. `batter_home_runs` → mlb only; keeps fan-out tight, avoids 429).
- Seed game labels from BOTH `ctx.realOdds` AND `ctx.realGames` (the e2e/real
  client often sends realOdds empty but a full realGames slate; label is
  `g.game` or `${awayTeam} @ ${homeTeam}`).
- Per support sport: GET `/api/sports/odds?sport=` to map "Away @ Home" → event
  id (cap ~6 events/sport), then GET `/api/sports/props?sport=&eventId=` per
  event; keep props whose market ∈ allowed set.
- Merge into filteredProps, dedup key = `sport|game|player|market|line|alt`
  (include sport+game or same-name players on different teams collapse).
- Wrap the whole thing in try/catch — best-effort, must never break chat; honest
  thin result if the feed is down.

**429 caveat:** the extra odds+props fan-out is bounded at ~1 odds + ≤6 props
calls per support sport. Fine for single-user/demo; under bursty multi-user load
the loopback calls can trip the per-IP limits (odds 60/min, props 120/min). If
that surfaces, early-stop once enough distinct players collected or lower the cap.

**Verify e2e:** POST /api/chat with a starved context (1 HR prop + the real MLB
slate in realGames, realOdds empty) → must return 3 distinct REAL HR picks
backfilled from the live feed. SSE delta shape is `data:{"content":"…"}` (NOT
OpenAI choices[].delta); model is silent ~30-60s before first token, use ≥110s
curl window.
