---
name: Improve-the-ticket chat intent
description: Coach "give me a better one" must rebuild/diversify the current slip, not be misread as a market/sport request
---

# Improve-the-ticket intent (chat.ts)

A user typing "give me a **batter** one?" (typo for "better") after the Coach critiqued an
over-correlated single-game parlay got a baseball **MLB hits** parlay — the model freely read
"batter" as baseball. There is NO `batter` MARKET_KEYWORD lock; this was pure model interpretation,
so the fix is intent detection + a system addendum, not a keyword change.

**Rule:** detect an improve-the-current-ticket intent server-side (chat.ts, shared by web + mobile
via POST /api/chat) and inject `improveSystemAddendum` telling the model to build a BETTER VERSION
of `context.currentSlip` / the just-critiqued ticket (diversify across games, drop
correlated/duplicate-player legs, trim to strongest), and that "batter one/ticket/version" means
"better" — never lock to a baseball market unless one was separately named.

**How to apply / gotchas:**
- Detection is TYPO-TOLERANT but precision-gated by ADJACENCY: `(better|batter)\s+(one|ticket|slip|version|card|option|parlay)`.
  A real baseball ask says "batter props"/"hits parlay" (no ticket-pronoun noun) → won't fire.
- EXCLUDE comparison interrogatives ("which/what is better", "compare", "vs", "rank") — those are
  the `extraSlips` compare/rank flow, not improve.
- "improve/fix/tighten/trim/diversify" must sit near a slip noun (this/that/it/ticket/slip/parlay/card/legs)
  so "improve my bankroll management" doesn't trigger.
- GATE on `currentSlip.length > 0` OR a prior assistant turn that actually mentioned a ticket
  (slip/ticket/parlay/legs/correlated/ML/spread/over/under/prop) — not just any assistant message.
- SAME-GAME precedence: when `sameGameIntent` is also on, the diversify bullet flips to
  "improve WITHIN the one game" so it doesn't contradict the same-game scope.
- api-server has NO watcher — restart `artifacts/api-server: API Server` after editing chat.ts.
