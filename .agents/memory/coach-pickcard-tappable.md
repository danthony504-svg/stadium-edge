---
name: Coach pick cards tappable → real stats sheet
description: Mobile AI Coach chat pick cards open the bet's real stats sheet on tap; honesty gating + prop-id threading.
---

Tapping a mobile AI Coach (`app/(tabs)/coach.tsx`) chat pick card opens the bet's REAL stats sheet:
prop → `/prop/[id]` (player game-log breakdown), game-level ML/spread → `/team-pick/[id]` (picked-team matchup).

**Wiring:** `PickCard` already supports `onPress?: () => void` (header/title/matchup area becomes tappable
with a "View AI breakdown" affordance; inner ladder/Edge/Add controls keep their own taps). A
`statsHandlerFor(p)` (useCallback over router) returns the handler or **undefined** so the card stays
non-tappable when there's no groundable sheet.

**Honesty gating (fail-closed, the whole point):**
- Props: undefined when both `player` AND `athleteId` are missing (sheet would have nothing to fetch).
- Game legs: `gameSideFromPick(p)` (exported from PickCard, parses the pick's own "Away @ Home" `game`
  string + selection text, NO feed lookup) returns null for props, totals (Over/Under name no single
  team), malformed labels, and ambiguous both-team matches; handler also undefined when `!p.sport`.
- **Never** open a team sheet for a game total and never side-guess.

**Prop-id threading gotcha:** chat prop ParsedPicks are built by `propPick`/`matchProp` from
`PropPoolEntry`, which originally dropped `athleteId` and the raw market key — so `/prop/[id]` (needs
`athleteId` to fetch the ESPN game log, soccer falls back to player NAME; `marketKey` to grade the line)
would have had nothing. Fix = add `athleteId?` + `marketKey?` to `PropPoolEntry` and populate in BOTH
builders (`buildChatContext` propPool.push AND `propPoolFromRealProps`), then copy onto the ParsedPick
(`player/athleteId/propMarketKey/propLine/propSide`). Both new fields are render-only — NEVER sent to AI.

**Why:** consistent with the data-boundary / never-fabricate rule — a tappable card must lead to real
numbers or not be tappable at all. Mirrors props.tsx `openPropDetail` and game/[id].tsx team-pick push
param contracts (keep those three in sync if the detail-page params change).
