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

**Gotcha — hiding prose removes proof-of-life:** a full-context build is slow
(~14s of model time; logs show contextChars ~142k, responseTime ~14000ms), so once
the lead-in is suppressed the user stares at a static "Building your parlay…" and
thinks it's frozen. Fix = surface live progress: count fully-streamed PICK lines and
render "Building your parlay… N leg(s)". The counter regex must require 3 pipes
(`/^PICK\s*:.*\|.*\|.*\|/i`) to mirror parsePicks' `parts.length >= 4`, or a
half-emitted line overshoots; count PICK only (never ALT) since ALTs aren't legs.
The endpoint itself is healthy (streams + closes with `{done:true}`); the spinner is
a feedback problem, not a hang.
