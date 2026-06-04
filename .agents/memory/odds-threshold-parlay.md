---
name: Odds-threshold parlay lock
description: How "build a 10 leg with -300 or less" / "+300 or more" is enforced so every leg clears the American-odds bound, across web + mobile + server.
---

# Odds-threshold parlay enforcement

When a user asks for a ticket where EVERY leg must clear an American-odds bound
("-300 or less", "+300 or more", "all legs at least +200"), three layers work
together. The model alone ignores the bound and fills with the strongest plays
regardless of price (observed: "-300 or less" returned -130/-128/-125/-115).

## The three layers (keep in sync)
A shared `parseOddsThreshold(text) -> {signed, mode:"atLeast"|"atMost"}` is
**duplicated in three files** — api-server `chat.ts`, stadium-mobile
`lib/format.ts`, stadium-edge `ParlayBuilder.tsx`. A change to one must hit all
three.
1. **Server addendum (primary lever)** — both web and mobile chat POST to the
   same `/api/chat`, so the system-prompt addendum drives compliance for both.
   Spell out the per-leg bound AND the non-linear ordering explicitly.
2. **Client post-parse filters (hard guarantee)** — drop any resolved leg whose
   `.odds` breaks the bound. Mobile: after `parsePicks` in `coach.tsx`. Web: in
   `renderAssistantMessage`.

## Gotchas (the parts that bit)
- **American odds are NOT linear.** `atMost` = `odds <= signed` (heavier
  favorites: -500 < -300 < -110). `atLeast` = `odds >= signed` (longer payouts;
  any positive price is longer than any negative). -130 is LONGER than -300, so
  it correctly fails "-300 or less".
- **The web chat has TWO independent PICK-line parse paths in
  `renderAssistantMessage`.** A pre-scan builds `rawMessagePicks` (feeds the
  snapshot card / add-all / math), and a SEPARATE `lines.map(...)` re-parses each
  `PICK:` line to render the per-leg cards. Filtering only the pre-scan list does
  NOT stop out-of-bound cards from rendering — any pick-level gate (threshold,
  and the existing finished-game suppression) must be applied in BOTH paths.
- **Null odds (PrizePicks DFS legs) can't be verified against a price bound** →
  excluded under a strict threshold (`oddsSatisfiesThreshold` returns false for
  null when a threshold is active).
- **False-positive guard.** A bare 3-4 digit number + comparator is NOT enough —
  "at least 100 yards" / "300+ passing yards" would otherwise register as a
  price bound and silently filter real legs. Require an explicit odds cue: a sign
  token (+/-/plus/minus), a "bare" trailing "+" (reject "300+ <letter>"), or an
  odds/price word nearby. `|n| >= 100` already rules out leg counts.
- The web filter finds the triggering user message by scanning `messages`
  backward from the assistant index for the nearest `role==="user"`.

**Why:** precision over recall — a false positive silently drops legs from a
normal parlay and confuses the user, whereas a missed unusual phrasing just
degrades to current (pre-feature) behavior.

**Not covered:** the web AI-outage fallback (`generateResponse` / `buildParlay`)
does not thread the threshold; only the live AI path is enforced.
