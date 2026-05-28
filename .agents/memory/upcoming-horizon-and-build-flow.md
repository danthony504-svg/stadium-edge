---
name: Upcoming list horizon + build-flow split
description: Why the home "Upcoming" list caps games to a near-term window, and why upcoming vs live "Build" buttons behave differently.
---

# Upcoming list needs a future-horizon cap

ESPN schedule feeds return games **weeks/months ahead**, especially for a sport
in its offseason (NFL in spring/summer). With no upper bound, the Upcoming list
balloons (e.g. 200+ games) and shows matchups that aren't bettable yet, burying
this week's real slate.

**The rule:** the Upcoming build must drop scheduled games whose start time is
beyond a near-term window (currently 7 days out). The existing guard only
dropped games already *past* their start; the future cap is the complementary
half. The popularity sort alone is NOT enough — it only de-prioritizes far-out
games, it doesn't remove them, so they still render.

**Why:** offseason NFL games dated weeks/months out were appearing in Upcoming.
**How to apply:** the cap lives in the `isScheduled` branch where `upcoming` is
built; keep both the past-start drop and the >window-ahead drop together.

# Upcoming "Build" asks leg count; live "Build" stays immediate

Two different entry points build a parlay from a single game:
- **Upcoming** "Build →" → must first ASK "how many legs?" (assistant question +
  quick-reply chips 2–6, or a typed number) BEFORE building. It does not
  auto-build a fixed-size ticket anymore.
- **Live** "Build best parlay from this game" → builds immediately. Live is a
  fast in-the-moment action, not a planned ticket, so it intentionally skips the
  leg-count question.

`buildParlayForRealGame` branches on `kind`: `"live"` builds right away,
everything else routes through the leg-count prompt. A typed numeric reply is
intercepted at the top of `sendMessage` only while a game is pending (and only
for genuine user input, never `override` calls) so it doesn't loop or hijack
normal chat.

**Why:** a code review caught that routing *all* real-game builds through the
prompt also made the search "LIVE" result prompt for legs — unintended. Gate by
`kind` to keep live immediate.
