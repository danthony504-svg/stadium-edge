---
name: Player Props add-to-slip needs skipValidation
description: Why the sample/hypothetical Player Props modal add buttons must bypass live-pool validation
---

# Player Props "Add to slip" silently dropped legs

The full-screen **Player Props** modal (opened by tapping a player; shows the
"Sample stats & game log — not live data" disclaimer) builds legs from
SAMPLE/hypothetical data. A synth player's `gameLabel` is often `"<team> game"`
(no `@`/`vs`), or the matchup isn't in the live pool when the Odds API is down.

**Rule:** every add path in this modal must call
`addLeg({...}, { skipValidation: true })`.

**Why:** plain `addLeg(leg)` runs `filterPicksToReal([leg])`; if the matchup
isn't verifiable in the live pools and `skipValidation` is falsy, it `return`s
early and DROPS the leg silently — the button appears to do nothing. With
`skipValidation:true`, addLeg still attempts canonicalization but keeps the
original leg when unverifiable and stamps `chatValidated:true` + `gameStartTs`,
so the slip-sweep `survives()` exemption keeps it (null `gameStartTs` skips the
max-age clause, so a sample leg persists until its game resolves final — which a
sample label never does — or the user removes it).

**How to apply:** the three Player Props add buttons are AI Suggested
"+ Add to slip", the manual Under button, and the manual Over button. The
SEPARATE "Team Total" modal (clickable teams) uses REAL game data and stats —
leave its `addLeg` calls validated; do NOT add skipValidation there.
