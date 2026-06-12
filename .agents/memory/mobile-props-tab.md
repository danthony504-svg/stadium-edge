---
name: Mobile Player Props tab
description: How the stadium-mobile Props tab mirrors the web "All Sports" props menu, and the cross-app slip parity rule it must honor.
---

# Mobile Player Props tab

The mobile app (artifacts/stadium-mobile) has a Props tab that mirrors the web app's
"All Sports" player-props menu. It is a top-level tab (more native than the web's
drawer), registered in BOTH `app/(tabs)/_layout.tsx` layouts (NativeTabs trigger +
classic Tabs.Screen) — adding a tab to only one silently hides it on the other iOS path.

## Data shape / fan-out
- `/api/sports/props` is PER-EVENT only. To list "all props for a sport" the tab
  fetches `getOdds(sport)` → pickable games → one `getProps` per game.
- Cap the fan-out (currently 12 games). The props route is 120/min + 5-min cached,
  so a dozen parallel calls is safe; uncapped across a big slate is not.
- Pass home/away NAMES (server resolves the real Odds API event id when the client
  id came from an ESPN/Bovada fallback) and team ids (for ESPN headshots).
- Show MAIN lines only (`!alt`) — alt-ladder rungs duplicate every player.

## Cross-app slip parity (durable rule)
Mobile slip pick strings MUST match the web app's format EXACTLY, because the same
strings feed the bet-slip dedupe key (`game|market|pick`) and the chat AI context.
- market = `"Player Prop"`, pick = `"{player} Over {line} {label}"` (and `Under`).
- The side token (`Over`/`Under`) is ALWAYS present, even for null-line yes/no
  markets like Anytime TD (the line segment is just empty). Dropping it for
  null-line props was a real bug caught in review.
**Why:** divergent pick strings break dedupe (duplicate legs) and any web↔mobile
state/AI consistency.

## Honest empty vs. error
Per-game prop fetches are caught individually so one 502 doesn't kill the screen,
BUT if EVERY pickable game's request fails, throw so the UI shows the retryable
ErrorState — otherwise a total outage masquerades as an honest "no props posted".

## Sport coverage
Only sports in MARKETS_BY_SPORT serve props (mlb/wnba/nba/nhl/nfl/ncaaf/ncaab/soccer).
tennis/ufc/tabletennis return [] from the props feed.

## Browse-only (moneyline) sports on the props tab
`BROWSE_ONLY_SPORTS = ["tennis","tabletennis"]` get a PILL but no props. When one is
selected the tab swaps the prop rails/list for a REAL posted-matches list:
- `pillSports` = PROPS_SPORTS ∪ BROWSE_ONLY_SPORTS (drives the pill row only).
- `propsSports` still drives the per-sport props `useQueries` — browse sports are NOT
  fetched for props (they have none).
- `isBrowseSport` early-returns `[]` from `gradeCandidates`/`valueProps`/`filtered` and
  disables `upsetsQ`, so the AI-RECOMMENDED/VALUE rails stay hidden (no ESPN feed =
  no model lean for these sports — honest, never fabricated).
- A separate `browseOddsQ = getOdds(sport)` (enabled only when isBrowseSport) feeds a
  `GameCard` list; tap → `/game/[id]` (loads by `getOdds(sport)` + `id` match). Both
  tennis (Odds API hash id) and tabletennis (Bovada numeric id) carry usable ids.
**Gotcha:** when sport ∉ propsSports, `selIdx` falls back to 0 (MLB), so `propsQ` points
at MLB — you MUST gate every props-derived memo/render on `isBrowseSport` or the tab
shows MLB data under a tennis pill. RefreshControl also branches on isBrowseSport.

## Search collapses to one row per player (decided)
When a search query is active, the props screen shows ONE tappable row per player
(name + "N markets · tap to view" + chevron), NOT every prop line. Tapping opens
the existing PlayerPropsSheet with all that player's markets for that game.
Grouping is per-(game,player) via a `playerResults` memo. Full per-prop PropRow
list still renders when search is empty.
**Why:** searching a name was dumping dozens of prop lines per player — unusable;
the sheet already shows the full breakdown, so search should just locate the player.
