---
name: Chat intent detection — wantsParlay must catch "leg(s)"
description: Parlay-intent regex in ParlayBuilder.tsx controls whether props get fetched; missing "leg" variants silently cap tickets at 3-4 legs.
---

The chat send handler decides whether to do an extra `/api/sports/props` fetch based on two intent regexes: `wantsProps` (explicit prop language) and `wantsParlay` (parlay-building language). If BOTH are false, no player props are merged into `realProps` for that send, so the AI only sees the 3 base markets per game (ML / Spread / Total) and — after the dedup + correlation hard bans — can only produce 3-4 unique legs for a single-game ticket regardless of what the user asked for.

**Why:** the original `wantsParlay` regex matched `parlay|ticket|build|picks|sgp|same-game` but NOT `leg` / `legs` / `N-leg`. Users naturally type "10 leg for nba game tonight" or "give me a 5-legger" — those didn't trigger the prop fetch, so the AI honestly responded "only 4 legs available" because that's all that was in context.

**How to apply:** any future addition to the natural-language vocabulary for parlay-building (e.g. "stack", "card", "slate", "round-robin") MUST be added to the `wantsParlay` regex in `ParlayBuilder.tsx`, otherwise the entire downstream prop-fetch + player-history + opponent-defense pipeline is silently skipped. The current regex covers parlay/ticket/build/picks/recommend/suggest/best+bets/lock/sgp/same-game/N-legger/leg(s). Sanity-check new vocab additions with a quick node REPL — false negatives here are the most common cause of "the AI keeps saying only N legs are available" complaints.

## Multi-turn intent loss (the *real* "only ~10 legs / realProps empty" cause)

Single-message regexes are NOT enough. A follow-up CORRECTION almost never repeats "parlay"/"leg": after the AI returns a 10-leg ticket the user types "no, give me the full 15", "I asked for 15", "do 15", "make it bigger", "the full fifteen". Those match neither `wantsParlay` NOR the `<N> leg` count regex, so on that turn: prop-fetch skipped → `realProps` arrives EMPTY at the model, AND `requestedLegs=0` → `bigParlay=false` → breadthMode off → alts kept → only ~6-7 distinct games. The model then honestly-but-wrongly says "only ~10 legs available, realProps is empty" even when the live 48h pool is rich (~98 games, NBA ~688 props).

**Fix shape (conversation-aware intent), all in the chat-send handler:**
- `inParlayConvo` = current-msg parlay intent OR a recent USER msg matched the parlay regex OR recent ASSISTANT text contains `PICK:`/leg/parlay/ticket (derived from the prior `messages` state, last 8).
- Leg-count resolution precedence: `keywordLegCount(text)` (the `<N> leg/pick/game` form is ALWAYS safe) → only when `inParlayConvo`: `bareLegCount(text)` (standalone 3-30) → `wordLegCount(text)` (number-word) → `inheritLegCount()` (scan prior USER turns newest→oldest, latest ask wins).
- JIT prop-fetch gate widened to `wantsProps || wantsParlay || requestedLegs > 0`; `wantsParlay` itself also fires when `inParlayConvo` + (resolved count OR "more/bigger/longer/full/add").

**Gotchas that bit the first attempt (caught in code review):** (1) number-words/bare numbers MUST be gated behind `inParlayConvo` or "I have fifteen dollars" sets requestedLegs=15; (2) inherit by RECENCY (scan newest→oldest), not by concatenating text + key-order matching; (3) NO regex lookbehind (`(?<!…)`) — older Safari throws; use a whitespace token-scan that trims surrounding punctuation but keeps `$`/`%` to reject money. Verify the whole truth table in the JS sandbox (mid-parlay follow-ups → fetch+count; "$15"/"15%"/"2:30 pm"/no-context → skip) — the UI test harness here is flaky on the ~30s+ streaming reply.
