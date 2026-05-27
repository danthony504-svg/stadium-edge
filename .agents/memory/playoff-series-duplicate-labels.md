---
name: Playoff series produce duplicate "Away @ Home" labels
description: Why label-based game lookups must disambiguate by status + start time, not return the first match
---

In a playoff series, the same two teams play multiple games over weeks — every game has an identical `"${away} @ ${home}"` label. The ESPN games feed returns ALL of them (Final from earlier, Scheduled for the next), and many lookups in the codebase key by that label string.

**Symptom:** A finished game's start time leaks onto the upcoming game's card. e.g. the May 31 Spurs/Thunder card renders "Tue, May 26 · 7:30 PM" because the May 26 Final entry came first in the array.

**Fix pattern for any label→game lookup:** Collect all candidates that match the label, then prefer:
1. Non-final games whose `startsAt` is in the future (10-min grace) — nearest-soonest first
2. Else any non-final game (covers in-progress / live)
3. Else the most recent past game (last-resort, so the lookup never returns null when data exists)

**Where this matters:** `lookupGameStart`, anywhere else that does `find(g => label === \`${g.awayTeam} @ ${g.homeTeam}\`)` and uses the result's start time. Audit any future label-keyed lookup with the same lens.

**Related:** When listing games for a sport detail page, sort the rendered list by start time too — `Object.entries(byGame)` preserves insertion order, which depends on feed ordering (not chronological).
