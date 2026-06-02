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

## Structural OVER-bias in the prop heuristics + heavy-favorite default ceiling
**Symptom (user showed a settled slip):** an entire card was heavy MLB favorites (-126 to -275) and player-points OVERS — and almost all lost. Two structural leaks, NOT a prompt-philosophy gap (value-over-chalk was already fully present):
1. **OVER-bias:** the `opponentDefense.offensive` prop-side rules in the SYSTEM_PROMPT were written almost entirely one-directionally ("HIGH pace → lean OVER", "LOW FG% → rebounds OVER", etc.) with the inverse UNDER cases mostly missing. That quietly inflates EVERY prop projection upward, so the AI defaults to OVER. **Fix:** add the equal-and-opposite UNDER trigger to each (slow pace / efficient / ball-secure opponent → UNDER) + a SYMMETRY MANDATE ("evaluate UNDER with the same seriousness; OVER is not the default") + a NO-DEFAULT-OVER line on the prop projected-hit-% rule (count real hits for the side; 1-2 of 5 IS a real UNDER, not a skip).
2. **Heavy-favorite default:** the HEAVY-JUICE WARNING was soft ("usually tiny edge"). **Fix:** hardened into a concrete DEFAULT CEILING — for ordinary (non-safe-ticket) requests, don't make a straight ML the PICK at -160 or heavier unless projection clears implied break-even by ~5+ pts; else step to that side's alt-spread near pick-em / plus money, switch market, or skip.
**Why:** the totals rule was already pace-driven (bidirectional) so it was NOT the culprit — left untouched. The prop opponent-defense block was the real OVER pump. Balance the heuristic; do NOT blanket-flip to UNDER (same fabrication trap inverted).
**How to apply:** "too many overs / too much chalk losing" → audit whether the prop lean heuristics are symmetric and whether heavy-ML has a concrete price ceiling, BEFORE adding more value-over-chalk prose (which already exists and isn't the gap).

## Middle-bet suggestions (spot & suggest, never auto-add)
**What:** the chat AI surfaces "middles" — two OPPOSITE alt-ladder bets on the SAME game that BOTH cash if the result lands in the gap (Over 224.5 + Under 230.5 → both win on a 225-230 total; or Fav -3.5 + Dog +7.5 → both win on a 4-7 margin). Prompt-only feature in chat.ts SYSTEM_PROMPT (MIDDLE OPPORTUNITY block, after the GAME-LEVEL alts rule).
**Why a middle must be INFORMATIONAL prose, NOT PICK: lines (the whole trap):** a middle is two contradictory bets; the client auto-add parser ingests any line containing the literal token `PICK:` + a `game | market | pick | odds` pipe row (regexes are NOT line-anchored — they match `PICK:` mid-line too). If the AI wrote the two middle legs as PICK: rows, they'd land in the user's parlay as contradictory legs (a parlay needs ALL legs to win, so a middle inside one parlay only cashes in the tiny window = backwards). So the hard rule: present under a plain "Middle opportunity:" label, and NEVER put the token `PICK:` ANYWHERE in that paragraph (not even as an example).
**Honesty:** only suggest when BOTH rungs really exist in realOdds/realProps (never invent a window); state it's two SEPARATE straight bets, a low-cost narrow-window variance play (outside the window you forfeit ~the vig), optional and below the main single-best PICK.
**How to apply:** any "make the AI suggest <multi-bet strategy>" (middles, arbs, hedges) → keep it out of the PICK:/pipe auto-add format or it pollutes the slip; surface as labeled prose only.

## Coin-flip DE-RISK (buy points to raise win%, the OPPOSITE of chasing juice)
**What:** prior alt-line rule said "for coin-flip/weak reads STAY on the main line." Sharp-user feedback: that just serves bare 50/50 picks. New rule (chat.ts SYSTEM_PROMPT, COIN-FLIP DE-RISK block right after the alt-line rules): on a coin-flip/slim-lean side/total/ML, OFFER a SAFER alt handicap that raises win probability.
**Two directions must stay separate:** (a) chasing PAYOUT with a TOUGHER alt on a shaky read (fav -7.5→-10.5, weak Over→higher Over) stays BANNED; (b) DE-RISKING with a SAFER alt to raise win% is ENCOURAGED — buy points (fav -10.5→-6.5/-3.5), take the dog with cushion (+13.5), swap a coin-flip/dog ML for that team's SPREAD WITH POINTS (Knicks +169 ML → Knicks +6.5), move a coin-flip total toward safety (Over 175.5→Over 169.5).
**Honesty trap:** user calls it a "larger ticket" but de-risking LOWERS payout (price gets more negative) — it buys win probability, NOT a bigger payout. Prompt forces the AI to state the tradeoff plainly. Real alt rungs/prices only (realOdds); no alt ladder → stay on main line, never invent a rung.
**Surfaces:** chat AI drives it; home-feed card "AI EDGE NOTE" text (noteByPickKey in ParlayBuilder.tsx) is derived from the AI's chat output, so this flows through. De-risk is a single replacement leg (safe to emit as a PICK: line / auto-add) — unlike a MIDDLE (two contradictory bets, info-only, never PICK:).
