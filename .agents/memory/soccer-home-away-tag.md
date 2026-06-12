---
name: Soccer HOME/AWAY pick tag
description: Why soccer ML/spread pick cards show a HOME/AWAY tag and the fail-closed rule behind it
---

Soccer game-line picks render the FULL team name on a 3-way line (e.g. "Canada -0.5"), which on its own doesn't read as which side. The mobile rich PickCard surfaces a small HOME/AWAY pill next to the pick title for soccer ML/spread legs.

**Why:** user request — soccer ML/spread "should be Home or Away". The nickname() shorthand that disambiguates US leagues ("Lakers") doesn't help national-team fixtures with multi-word names on a 1X2 market.

**How to apply:**
- Derive the side from the existing `gameSideFromPick(pick)` (reads the pick's own "Away @ Home" label + selection text; no feed lookup).
- It is FAIL-CLOSED: returns null → render NO tag (never guess) for props, totals, the Draw outcome, and ambiguous/both-or-neither-team labels. Do not "fix" a missing tag on Draw/ambiguous — absent is the correct, honest behavior.
- Gate on `pick.sport === "soccer"` only (soccer-specific by the request; US leagues read fine from the nickname).
- Tag color mirrors `MatchupLine`: away = blue (primary), home = red (destructive).
- Tag reflects the FEED-designated home/away (correct even for neutral-venue World Cup games), matching the odds feed and the "Away @ Home" matchup string.
