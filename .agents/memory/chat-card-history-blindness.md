---
name: Chat card history blindness
description: Why stat/period cards must be serialized into chat history before the AI can answer follow-ups about them
---

# Card messages are invisible to the chat AI

Stat and period cards in ParlayBuilder render as messages with `content: ""` and the
real data on side fields (`m.periodGameLog`, `m.statCard`). The chat send builds the
AI history by mapping ONLY `m.content` (last-8 slice). So any follow-up that references
data the user is looking at ("based on that, how might he match up?", "what do you
think he'll score?") reached the AI with EMPTY assistant turns — the model never saw
the numbers and couldn't answer.

**Fix:** a `histText(m)` serializer (used in the history `.map`) emits the card's REAL
figures as text, tagged `[Real data already shown to the user]`:
- periodGameLog → "<player> — <period> <stat>, last N: <date loc opp value>; … (avg X)"
  — opponent is in each row, so the AI can read prior meetings vs a team directly.
- statCard → player + season per-game averages + statmuse headline.
- Appends to `m.content` if a message ever has both; otherwise returns `m.content`.

**Why:** the data feeding the cards is real (StatMuse/ESPN); the only gap was that it
never reached the model. Serializing what's already on screen is honest grounding, not
fabrication. Pair it with the SYSTEM_PROMPT "PLAYER PERFORMANCE PROJECTIONS" clause so
the AI gives a reasoned projection (range + projection wording, cite the real per-game
numbers, HARD ban on inventing opponent "allowed"/season numbers) instead of refusing
or just repeating the grid.

**How to apply:** any NEW card type added to chat messages with non-content payload
must be added to `histText` too, or follow-ups about it will silently lose the data.
Chat route is `POST /api/chat` (router mounted at `/api`), NOT `/api/sports/chat`.
