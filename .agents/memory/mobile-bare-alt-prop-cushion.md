---
name: Mobile bare-alt props default to cushions (no playerHistory in context)
description: Why bare "alt" prop picks come back as deep cushions on mobile and the deterministic plus-money upgrade that fixes it
---

# Mobile bare-alt prop picks default to cushions — fix is deterministic, NOT prompt

Symptom: a mobile Coach "N leg alt" request returns PLAYER PROPS as deep cushions
(e.g. Alyssa Thomas Over 6.5 Assists -245) even when a real plus-money value rung
exists in the ladder (her Over 8.5 +120). Game-side alts come back as a good
plus-money mix; only the props cushion. Persisted across FOUR shared-prompt edits.

**Why (the trap):** the shared SYSTEM_PROMPT (api-server/chat.ts) steers bare-alt
props to their plus-money rung using a "playerHistory reachability" gate. But the
MOBILE chat context (stadium-mobile/lib/api.ts) carries NO per-player game-log
data at all — `playerHistory` appears 0 times in mobile api.ts; only web's
ParlayBuilder builds + sends it. So on mobile the model has zero basis to step up
and always picks the shorter-priced (safer-looking) cushion rung. A shared prompt
that depends on data only ONE client sends is INERT on the other client — no
amount of prompt tuning fixes it there.

**The data is all present:** the Odds API alt ladder carries the plus-money rungs,
and mobile's `propPool` (returned uncapped from buildChatContext, unlike the
balanced `realProps`) retains every emitted rung incl the +120 value rung. So the
fix is a deterministic SELECTION upgrade, not a feed/emission change.

**Fix (mobile client only, 2 files):**
- components/PickCard.tsx `matchProp()` gains `preferPlusMoney`. After it resolves
  a prop PICK to the exact posted rung the model named, if the flag is set AND the
  rung is a cushion (`best.line != null && best.odds < 100`), swap to the
  LEAST-AGGRESSIVE real plus-money rung (smallest odds >= +100) on the SAME
  game + EXACT full player name + normalized marketLabel + side, from propPool.
  `parsePicks()` forwards the flag. Bounded (closest-to-even, never the deep
  longshot); never-fabricate intact (target is a real propPool rung w/ real odds).
- app/(tabs)/coach.tsx computes `bareAltIntent` = alt-stem regex AND NOT
  safe/safer/lock AND NOT oddsThreshold, passes it to parsePicks.

**Gotchas:** match the FULL resolved player name (not surname) or a same-surname
teammate in the same game/market/side can be swapped in. yes/no markets
(line == null) and game-side picks are untouched. Leave the web-only prompt
additions in place — they still help web (which HAS playerHistory).

LESSON: before iterating a shared LLM prompt to fix client-specific behavior,
verify the data the prompt relies on actually reaches THAT client's context.
