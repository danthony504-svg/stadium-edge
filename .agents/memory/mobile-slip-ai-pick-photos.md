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

## Shared AiPickCard + game-detail AI picks
- The compact card lives in `components/AiPickCard.tsx` (shared) — avatar
  (headshot/logo/initials w/ onError fallback) + a collapsible "AI Edge" pill
  showing `pick.edge`. slip.tsx imports it; don't reintroduce a local copy.
- Game detail (`app/game/[id].tsx` → `AiGamePicks`) gets per-game AI picks WITHOUT
  a backend single-game endpoint: it reuses the chat stream. Naming exactly ONE
  game in the message (`best bets for <Away @ Home>`) game-locks the model to that
  matchup. Flow: `buildChatContext([game.sport],[],signal)` → `streamChat` →
  `parsePicks(full, context.realOdds, propPool, gameMeta)` → filter via exported
  `sameGame(p.game, gameLabel)`. Fail-closed: empty resolve → honest "no edges"
  message, never sample data.
- On-demand (button), NOT on every open — each run is a real billed AI call.
- Lifecycle: abort prior controller on refresh AND on unmount
  (`useEffect(()=>()=>abortRef.current?.abort(),[])`); guard every setState with
  `abortRef.current === controller` so a superseded request can't clobber state.

## Game-total cards: dual-logo matchup (not a bare "U")
- A TOTAL pick names no single team, so `teamSideFromPick` returns null and the
  avatar used to fall back to initials ("Under" → "U"). Fix: in parsePicks'
  game-level branch, the `else` (null side) attaches BOTH teams' real logos+codes
  (`awayLogo/homeLogo/awayAbbr/homeAbbr`) from `gameMeta`. Same optional fields
  added to ParsedPick AND BetSlipContext.AiPick (parity so the aiPicks store keeps
  them — assignment keeps extra props at runtime even though TS optional makes the
  narrower type assignable). AiPickAvatar renders a dual-logo pair (per-logo
  onError → initials); subtitle shows "AWAY @ HOME · TOTAL". Still fail-closed:
  no meta → fields stay null → initials/market-only.

## aiPicks store is stale-prone — enrich at RENDER, not just parse
- `aiPicks` (BetSlipContext) is an in-memory store written once by coach.tsx. A
  parser change that adds new fields (e.g. team logos) does NOT retroactively fix
  already-stored picks — Expo Fast Refresh updates component code but PRESERVES
  React state, so cards render new UI over stale data (e.g. AI Edge pill shows but
  logos missing). Symptom: "I added logos but the card STILL shows U".
- Fix pattern: re-resolve at render. Extracted `enrichPickMeta(pick, gameMeta)`
  (exported from PickCard.tsx) from parsePicks' game-level branch; slip.tsx fetches
  games per unique aiPick sport via `useQueries(getGames)`, builds gameMeta with the
  exported `buildGameMeta(games)` (lib/api.ts, also reused by buildChatContext), and
  maps aiPicks through enrichPickMeta before rendering.
- `enrichPickMeta` MUST be non-destructive AND prop-safe: first guard
  `if (pick.isProp) return pick;` (props show a headshot, never a team logo — and a
  prop's headshot can be null on a feed miss, so a headshot-truthiness check alone
  is NOT enough). Then skip if any logo already set (idempotent). Only then resolve
  team side / total dual-logos. matchProp sets isProp:true on prop legs.

## SlipBar must live at ROOT, not in (tabs)/_layout
- The floating bet-slip popup (`components/SlipBar.tsx`) was rendered in
  `app/(tabs)/_layout.tsx`, so it only covered tab screens. `game/[id]` and
  `upcoming` are ROOT-level routes (siblings of `(tabs)` in `app/_layout.tsx`) —
  they never got the bar. Fix: render `<SlipBar/>` ONCE in `app/_layout.tsx`
  (after RootLayoutNav, inside GestureHandlerRootView/KeyboardProvider, within
  BetSlipProvider+SafeAreaProvider) and remove it from the tabs layout (avoid
  double-render). It self-hides on `/slip` + `/coach` via usePathname; NavMenu
  (hamburger) stays in tabs. Any "show X on all pages" overlay must be at root,
  not the tab group.

## Bet Slip "To win" = profit only
- SlipScreen "To win" must be `payout(stake, combined) - stake` (profit), not the
  full payout. `payout()` returns total return (stake + profit). SavedSlipCard's
  `$stake → $total` line is intentionally total return ("you get back"), left as-is.
