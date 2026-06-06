---
name: Soccer player history (name-keyed)
description: Why soccer player season stats + per-game logs come from StatMuse keyed by NAME, and the gotcha that the mobile Player Props UI must unlock on the name source, not athleteId.
---

Soccer player history (recent form + season summary + home/away splits) on the
mobile Player Props screen is sourced from StatMuse's per-game grid, **keyed by
the player's NAME**, because ESPN has no usable soccer game-log endpoint (v3
gamelog/stats return errors for soccer athletes). The ESPN athleteId carried on
soccer props is meaningless to StatMuse.

The server `/sports/player-history` branches on `sport==="soccer"` BEFORE the
ESPN athleteId requirement, reads a `name` query param, and rebuilds the exact
same response shape (`labels/recent/seasonSummary/homeSplit/awaySplit`) so the
client renders soccer identically. Honesty: returns empty buckets on miss/no
name/error, never fabricated numbers.

**Gotcha (the bug that slipped through first pass):** the mobile UI gated every
stats/log section on a present `athleteId`. Soccer athleteId is null, so valid
returned data was hidden behind "stats aren't available". Fix = a single
`hasHistorySource = !!athleteId || (isSoccer && !!player)` driving all four
gates (season stats, recent log, suggested lines, set-your-line). Any new
name-keyed (athleteId-less) sport must do the same.

**Why:** ESPN/StatMuse split — some sports are id-keyed, soccer is name-keyed;
UI conditionals anchored on athleteId silently break the name-keyed path.

**How to apply:** when wiring a name-keyed history source, audit EVERY
`athleteId &&` / `!athleteId` render gate, not just the query `enabled`.
