---
name: Props-tab AI RECOMMENDED real grading
description: How the mobile Props "AI RECOMMENDED" rail grades picks honestly and resolves upset navigation.
---

# Props-tab AI RECOMMENDED grading (mobile)

The "AI grade" (A/A-/A+) on the mobile Props tab rail is NOT a fabricated model
rating — the app has no edge/confidence feed (the prop & team-pick detail pages
list "AI grade, edge %, confidence" under NOT SHOWN — NO DATA FEED). It is a
transparent letter derived ONLY from the player's REAL recent game log: per
candidate, fetch `getPlayerHistory`, count clears of THIS posted line over the
last N games (`gameValueForMarket` + `computeAmbiguous`), grade by hit-rate
(≥80 A+, ≥70 A, ≥60 A-). Captioned "Hit X/N recent games". Skip when sample is
too small or no feed (tennis/ufc) — never grade.

**Why:** honesty-sensitive app; a letter grade reads as authoritative, so it must
be a real, disclosed hit-rate, never the chat model's stated edge (PickCard's
separate `deriveGrade` is edge-driven and does NOT fire here — recommended cards
use `hideReadout` and pass an explicit `badge` prop instead).

Composition: A-tier graded props + model-backed confident upsets
(`fetchUpsetSpots`) earn a badge and come first; if NONE qualify, fall back to
best real value picks ranked by longest posted price, NO grade badge, so the
section is never empty.

**Upset → team-pick nav:** `UpsetSpot.side` is EXACTLY the away or home substring
of `UpsetSpot.game` ("Away @ Home") — both come from the same `split(" @ ")` in
`computeMlLean`. Resolve isHome with full-string equality (`u.side === homeFull`),
NOT last-token `nickname()` matching, which collides for shared trailing tokens
(soccer FC/SC). Carry the resolved {team,opp,isHome} on the rec item so nav never
re-guesses the side.
