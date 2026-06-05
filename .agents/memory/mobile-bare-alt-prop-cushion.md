---
name: Mobile bare-alt prop rung selection (cushion default, value override)
description: How an explicit "alt" Coach request picks which real prop rung to take on mobile, and why a shared prompt can't do it
---

# Mobile bare-alt prop rung selection — deterministic, NOT prompt

Symptom history: a mobile Coach "N leg alt" request resolves PLAYER PROPS to
whatever rung the model first emits. Users care which rung: they want SAFE,
deep-juice cushions (-200..-500), not plus-money longshots (the +100/+300 rungs
are what they reacted to and asked to replace).

**Why a shared prompt can't fix this on mobile:** the shared SYSTEM_PROMPT
(api-server/chat.ts) reasons about rung choice using per-player game-log
("reachability") data. But the MOBILE chat context (stadium-mobile/lib/api.ts)
carries NO game-log data (web's ParlayBuilder builds + sends it; mobile does not,
0 refs). So on mobile the model has no basis to choose a rung — the prompt is
INERT there. Don't iterate a shared prompt to fix client-specific behavior
without first verifying the data it relies on reaches THAT client.

**The lever:** mobile's `propPool` (returned uncapped from buildChatContext,
unlike the balanced `realProps`) retains every emitted alt rung incl deep
cushions and plus-money rungs. So a deterministic SELECTION swap in matchProp
honors intent without fabrication (target is always a REAL posted rung w/ REAL
odds).

**Design — `AltRungBias = "value" | "cushion" | null`** (replaced the old
`preferPlusMoney` boolean). matchProp/parsePicks take it; coach.tsx computes it:
- bare "alt" (alt-stem regex, not odds-bound)  -> **"cushion"** (the DEFAULT)
- alt + value/plus-money/longshot/underdog/upside -> "value"
- odds-bound ("-300 or less") -> null (its own filter handles rungs)

In matchProp, after resolving the prop to the named rung, swap among REAL rungs
on SAME game + EXACT full player name + normalized marketLabel + side:
- **cushion**: most-negative odds rung that is still >= CUSHION_FLOOR (-550) and
  < 0. = deepest/safest rung within the floor. Each player's ladder differs, so
  this naturally SPREADS legs across -200..-500 (not all at the floor).
- **value**: only if resolved rung is itself a cushion (odds < +100), swap to
  least-aggressive plus-money rung (smallest odds >= +100). Closest-to-even
  upside, never the deep longshot.

**Gotchas / invariants:**
- Match the FULL resolved player name, not surname (same-surname teammate trap).
- yes/no markets (line == null) and game-side picks untouched.
- Fail-open: no eligible rung within band -> no swap, keep the model's rung
  (never fabricate a cushion that isn't posted).
- CUSHION_FLOOR = -550 (user listed up to -500 "ect"); tighten to -500 if users
  complain of over-juiced clustering.
- Leave the web-only prompt additions in place — they still help web.

KEY LESSON: the user's "alt" preference flipped 180° between turns
(plus-money -> cushion). The durable design is a single biased-selection knob
with cushion as the default, not a one-direction hack.
