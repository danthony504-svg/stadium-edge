---
name: Chat intent detection — wantsParlay must catch "leg(s)"
description: Parlay-intent regex in ParlayBuilder.tsx controls whether props get fetched; missing "leg" variants silently cap tickets at 3-4 legs.
---

The chat send handler decides whether to do an extra `/api/sports/props` fetch based on two intent regexes: `wantsProps` (explicit prop language) and `wantsParlay` (parlay-building language). If BOTH are false, no player props are merged into `realProps` for that send, so the AI only sees the 3 base markets per game (ML / Spread / Total) and — after the dedup + correlation hard bans — can only produce 3-4 unique legs for a single-game ticket regardless of what the user asked for.

**Why:** the original `wantsParlay` regex matched `parlay|ticket|build|picks|sgp|same-game` but NOT `leg` / `legs` / `N-leg`. Users naturally type "10 leg for nba game tonight" or "give me a 5-legger" — those didn't trigger the prop fetch, so the AI honestly responded "only 4 legs available" because that's all that was in context.

**How to apply:** any future addition to the natural-language vocabulary for parlay-building (e.g. "stack", "card", "slate", "round-robin") MUST be added to the `wantsParlay` regex in `ParlayBuilder.tsx`, otherwise the entire downstream prop-fetch + player-history + opponent-defense pipeline is silently skipped. The current regex covers parlay/ticket/build/picks/recommend/suggest/best+bets/lock/sgp/same-game/N-legger/leg(s). Sanity-check new vocab additions with a quick node REPL — false negatives here are the most common cause of "the AI keeps saying only N legs are available" complaints.
