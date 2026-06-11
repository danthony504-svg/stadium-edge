---
name: Game-detail player props section
description: Mobile game/[id].tsx had no player props because it never called getProps; how the section was added and the shared-row single-source-of-truth rule.
---

The mobile game-detail screen (`app/game/[id].tsx`) historically rendered ONLY
game-line + period markets (getOdds → MarketBlock/AiGamePicks). It never called
`getProps`, so NO sport showed player props there. A "no player props" report on
that screen is this MISSING-FEATURE, not a per-sport (e.g. soccer) data bug.

**Single source of truth for prop rows:** the prop-row presentation + the slip
pick-string were extracted from the Props tab into `components/PlayerPropRow.tsx`
(exports `Avatar`, `PropRow`). The Props tab now imports from it.
**Why:** the pick string (`"${player} Over${lineTxt} ${label}"` / Under, side
token ALWAYS present, `addLeg({game, market:"Player Prop", ...})`) must stay
byte-identical across Props tab + game-detail + Coach or the slip stops deduping.
**How to apply:** any change to prop pick-string format goes in PlayerPropRow,
never re-implemented per surface.

**The section** (`components/GamePropsSection.tsx`): gated to `PROPS_SPORTS`
(returns null otherwise — no empty noise for tennis/ufc/club-soccer), fetches
`getProps`, groups mains (`!alt`) vs alt ladders by player+market, opens
`PlayerPropsSheet` with the sheetHidden+useFocusEffect hide/restore pattern.
Honest loading/error/empty states; renders ONLY real `getProps` prices.

**Gotcha:** game-detail has no ESPN idMap, so it passes `teamAbbr:null` and no
`homeTeamId/awayTeamId` to getProps — headshots/teamAbbr are best-effort there
(fine: soccer headshots are null anyway). The Props tab passes ids for headshots.
