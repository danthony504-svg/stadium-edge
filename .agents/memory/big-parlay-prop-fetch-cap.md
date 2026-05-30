---
name: Big-parlay prop-fetch cap must scale with requested leg count
description: Why a "15-leg" ask returned only ~10 legs with zero props, and the cap-scaling fix in the chat JIT prop-fetch block.
---

# Big-parlay prop-fetch cap scaling

"I asked for a 15-leg parlay and got ~10 legs with ZERO player props" is NOT a
prompt problem and NOT a no-data problem — it's the client's just-in-time
prop-fetch block capping how many games' props it fetches, independent of the
requested leg count.

**Mechanism (ParlayBuilder.tsx chat-send prop-fetch block, the `if (wantsProps || wantsParlay)` gate):**
- For generic parlay intent (no prop-market keyword, no named game) the caps were
  static: `perSportCap = 3`, `totalCap = 6`. So props were fetched for at most 6
  games no matter how many legs were requested.
- Player props are the prompt's PRIMARY lever to reach high leg counts (distinct
  players = distinct non-correlated legs; one-leg-per-game/market-family ban means
  game-level legs alone top out at ~2 independent sides per game).
- Net: few games × ~2 game-level legs + props for only 6 games ⇒ ~10-leg
  structural ceiling, and on a thin slate the props often didn't even surface.

**Fix:** parse the requested leg count N from the message
(`text.match(/(\d+)\s*-?\s*(?:leg|legg|pick|game)/i)`), and when `N >= 8`
(bigParlay) scale the caps: `perSportCap = min(N,12)`, `totalCap = min(N+4,24)`.
Only games that truly exist in the 48h window get fetched; bounded concurrency
(5 workers) + the 5-min server prop cache + the 429 retry keep it cheap.

**Why this is the right lever, not the prompt:** chat.ts SYSTEM_PROMPT already
makes the "N-leg" REQUEST TYPE override the generic "no game named → 4-5 leg
random ticket" default (the precedence line + "N-leg → return EXACTLY N PICK
lines"). The AI WANTS to build 15; it just had no props to climb past ~10. The
honest-design rules (no correlated/fake filler, return shorter ticket if data is
thin) are correct and untouched — the fix supplies MORE real props, never loosens
a ban.

**Gotchas / non-obvious:**
- `isWithin24h` in this block is MISNAMED — it actually enforces a 48h window
  (`CHAT_WINDOW_MS = 48h`). Don't "fix" it to 48h thinking it's 24h.
- Props ARE fetchable for fallback-odds games (ESPN/Bovada ids) via the
  home/away → real Odds API id resolution; pass `home`/`away` in the props query.
- `wantsProps` (explicit prop keyword) already uncapped to 5/12, and
  `wantsWideProps` (HR/K/anytime-TD) to 999 — this fix only raises the
  parlay-ONLY (generic) path that previously stayed at 3/6.
