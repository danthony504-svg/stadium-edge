---
name: AI picks echo the market (chalk) — value-over-chalk reframe
description: Why the pick AI kept restating the favorite despite a full EV framework, and how the prompt was reframed to hunt mispricing instead.
---

**Symptom:** users feel the chat AI "just picks what the market says" — the favorite / chalk side — instead of using its analytics to find a better bet.

**Root cause (non-obvious):** the SYSTEM_PROMPT already had a real EV framework, but it was framed as a FILTER ("only pick if your estimate clears the implied break-even"), not as a SEARCH for mispricing. Worse, nearly every analytics signal the prompt weighs — better L10 margin, better record/H2H, home-venue form, win streak, rest edge — points at the STRONGER team, which is almost always the FAVORITE. So "analytics" and "market" systematically agree and the AI lands on chalk and effectively restates the line.

**Fix (prompt-only, chat.ts SYSTEM_PROMPT, EV section):**
1. Made the projected%-vs-implied% gap a REQUIRED statement in every moneyline/spread/total/period side EDGE note (was optional "when it's the deciding factor"). Forces the AI to actually do the EV comparison instead of hand-waving "better team".
2. Added a "VALUE OVER CHALK" block: betting is beating the PRICE, not predicting the winner; a favorite winning is already priced in; BANNED to justify a side with only "favored/better team/better record/will win"; must check BOTH sides' edge and take the larger real edge (often the dog/spread/under/prop); heavy-juice warning (−250+ needs ~71%+ honest projection to break even → pivot to alt-spread/dog/total/prop).

**Guardrails that keep it honest (added after code review, both essential):**
- ANTI-FABRICATION ESCAPE: a projected % must be grounded in real context signals; if too thin to quantify, state a margin/total or qualitative lean or DROP the leg — never invent a pseudo-precise %. The no-invention core principle still wins over the "state a gap" mandate.
- PRECEDENCE: explicit request-type locks override value-over-chalk — a "safe ticket"/"low-risk"/"lock" ask still goes favorites-only (but pick the best-edge favorite rung, usually the alt-spread near pick-em over heavy ML).

**Why:** without #1 the EV rule is unfalsifiable and gets skipped; without value-over-chalk the AI confuses "who wins" with "what's the bet"; without the two guardrails the mandate backfires into fabricated percentages or wrong-direction safe tickets.

**How to apply:** any future "the AI is too chalky / not using its data" complaint — check whether the new signal is being added as a FILTER (confirms chalk) vs a divergence/mispricing search, and whether picks are forced to state the projected-vs-implied gap. Never fix "too chalky" by pushing contrarian/underdog picks that the real data doesn't support — that just trades echoing-the-market for fabrication.
