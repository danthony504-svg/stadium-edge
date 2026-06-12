---
name: Table tennis removed (for now)
description: Table tennis pulled as a user-facing sport; where to re-add it if it comes back
---

Table tennis was removed as a user-facing sport ("for now" — temporary). It no longer appears in any sport picker, the Coach pool (DEFAULT_SPORTS), the Props tab, or the AI prompt.

**Why:** User asked to pull it; data coverage was moneyline-only and thin.

**How to re-add:** the api-server data-layer plumbing was deliberately LEFT INTACT (lib/sports.ts `tabletennis: []` keys, routes/games.ts ESPN path `table-tennis`, routes/odds.ts `moneylineOnly` branch) so re-adding is just the user-facing surfaces. To bring it back, re-add:
- stadium-mobile/lib/sports.ts — the SPORTS entry (id `tabletennis`); this auto-restores DEFAULT_SPORTS.
- stadium-edge/src/ParlayBuilder.tsx — the sports-list entry AND the `isIndividual` OR-clause.
- stadium-mobile/app/(tabs)/props.tsx — add `"tabletennis"` back to BROWSE_ONLY_SPORTS.
- stadium-mobile/app/game/[id].tsx — the TableTennisNote component + its `game.sport === "tabletennis"` render gate (honest "no stats source" note).
- stadium-mobile/components/PickCard.tsx — `marketDisplayLabel` sport check (tennis-style game-handicap label).
- api-server/src/routes/chat.ts — SYSTEM_PROMPT sport list + the "Table Tennis is winner-odds only" sentence (restart api-server after).
