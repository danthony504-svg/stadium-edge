---
name: Mobile AI Coach — suppress parlay lead-in prose
description: Why/how the mobile coach hides the streamed intro paragraph during a parlay build, showing only the "Building your parlay…" indicator.
---

When the mobile AI Coach (stadium-mobile `app/(tabs)/coach.tsx`) builds a parlay,
the model streams a lead-in paragraph ("Here's a balanced 5-leg ticket…") BEFORE
the `PICK:`/`ALT:` scaffold lines. That intro must NOT land in the chat — the value
is the pick cards (each carries its own EDGE note). Only the "Building your parlay…"
indicator should show until the cards resolve.

**Why:** users complained the pre-text kept appearing in chat on "Build best parlay".

**How to apply:** suppression is driven by `isBuildingParlay`, which is true when
streaming the last assistant message with no parsed picks AND either
(a) the preceding USER message matches `PARLAY_BUILD_RE` (conservative build-intent:
build…parlay / N-leg / longshot / "player props only") — this catches the EARLY
stream before any PICK line so the prose never flashes — or (b) a `PICK_SCAFFOLD_RE`
line has arrived. `showBubble` must include `!isBuildingParlay`. Keep the intent
regex narrow so plain Q&A ("what is a parlay", "is my parlay good") still streams
its answer. Once `hasPicks`, `assistantBubbleText` already returns "" so the bubble
stays hidden and cards render.
