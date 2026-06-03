---
name: Mobile slip AI-pick photos/logos
description: How real headshots/team logos get onto the mobile Bet Slip AI Recommended cards without leaking visual data to the AI.
---

# Mobile AI-pick cards: real headshots + team logos

AI Recommended cards (slip.tsx `AiPickAvatar`) show a real ESPN player headshot
for prop legs and the picked team's logo+abbr for game legs, with an initials
fallback.

**Why the render metadata is returned separately from ChatContext:**
`streamChat` POSTs `{ messages, context }` — the WHOLE `context` object goes to
the AI. So headshots/logos/abbrs must NEVER be put on `ChatContext`. Instead
`buildChatContext` returns `BuiltChatContext = { context, propPool, gameMeta }`:
- `propPool` rows carry `headshot` + `teamAbbr` (built from the raw `PlayerProp`
  feed: `p.headshot`, `p.playerTeamId`→abbr via a `teamMetaById` map from ESPN
  game team IDs). The lean `RealPropEntry` sent to the AI does NOT carry them.
- `gameMeta[]` = per-game `{game, home/awayTeam, home/awayAbbr, home/awayLogo}`
  from ESPN games, keyed by the `"Away @ Home"` game string.

**How a card gets its image:**
- Prop legs: `matchProp` copies `headshot`/`teamAbbr` onto the ParsedPick.
- Game legs: `parsePicks(text, realOdds, propPool, gameMeta)` resolves the picked
  team via `teamSideFromPick(meta, pick)` — token/abbr overlap between the
  selection and each team. Returns `null` for totals (no team named) → no logo,
  falls back to initials.

**Gotchas:**
- `coach.tsx` is the only caller; it must destructure `{context, propPool,
  gameMeta}` and pass `context` (only) to `streamChat`, then
  `parsePicks(full, context.realOdds, propPool, gameMeta)`.
- `AiPickAvatar` also degrades to initials on `Image` `onError` (broken URL),
  not just missing-metadata.
- Removed the old `propPoolFromContext` helper — propPool is now built inline in
  `buildChatContext` because headshot/playerTeamId only live on the raw
  PlayerProp, which is stripped before the AI body.
- Two distinct `GameMeta` types exist: `@/lib/api` (this one) and
  `@/components/GameCard` (unrelated). No single-file collision; don't merge.
