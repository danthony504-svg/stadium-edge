---
name: Conversational HR-evaluation prompt scope
description: Why the MLB HR analytics rules need a "applies to any HR question, not just a parlay build" trigger, and the total-vs-park ranking trap.
---

# Conversational HR-evaluation prompt scope

The chat coach's rich MLB HR analytics rules (HR ENVIRONMENT / MLB PLATOON / MLB BATTER-VS-PITCHER / playerHistory) were all framed around PICKING PROPS during a parlay build. A purely CONVERSATIONAL home-run question — "do you like this research for which guys to homer", a pasted list of HR-target hitters, "rank these guys for HRs" — did NOT trip those rules, so the model fell back to ranking HR "environments" by the GAME TOTAL and quoting the HR PRICE, and never surfaced the real park/platoon/recent-form/BvP data that WAS in context.

**Why:** prompt rules scoped to a "build" intent leak on terse/conversational asks (same class as chat-intent-detection.md). The data path was fine — the coach cited HR prices, proving realProps/realOdds reached it; the named-game context trim leaves mlbGameEnv/mlbPlatoon intact; BvP enrichment builds from mlbPlatoon regardless of build intent. The gap was purely the prompt not routing a conversational question into the existing analytics.

**How to apply:**
- The fix is a dedicated "HOME-RUN EVALUATION RULE — APPLIES TO ANY HR QUESTION, NOT JUST A PARLAY BUILD" paragraph (in chat.ts SYSTEM_PROMPT, right after the MLB NEVER-FABRICATE clause). It mandates grounding in the same real signals for evaluate/rank/sanity-check/"do you like these" asks, even when only names are pasted.
- THE RANKING TRAP: a high game total is only the run-environment TIE-BREAKER, NOT the HR-environment proxy when a real mlbGameEnv park entry exists. Coors (Rockies home) is the biggest park tailwind on most boards — if a Rockies home game is present the answer MUST cite the park (hrIndex/altitude), not just its total. The HR price is the market's opinion, used only to find VALUE AFTER the real-data read.
- Honesty rider is required: use whichever signals are actually present per hitter, explicitly call out missing ones, never pad to all five or invent an absent park/platoon/recent/BvP value.
- General lesson: any analytics rule you add for "building picks" should be checked against the conversational/evaluation phrasing of the same question; if it only triggers on build intent, add an explicit conversational trigger or it silently won't fire.
