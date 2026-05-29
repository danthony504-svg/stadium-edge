---
name: Team detail page (clickable teams)
description: Team detail view mirrors the player-props page but must use REAL data; async open-handler needs a cross-team race guard.
---

# Team detail page

Tapping a team in the game-detail overlay header opens a detail view that mirrors
the Player Props (selectedPlayer) page, but for a TEAM TOTAL.

## Honesty rule (critical)
Teams are NOT the sanctioned fabrication exception — only the Player Props page is.
So the team page's identity, last-10 stats row, and recent-performance chart MUST be
real. They come from the matchup-history feed: the route now also returns a real
per-game `recent` array (last-10 final scores from ESPN), not just averages.
**Why:** a fabricated team game log would break the app's STRICT no-fabrication rule.
**How to apply:** only the user-settable team-total line and its derived odds are
estimates, and the page disclaimer must say exactly that ("recent scores & averages
are real … lines you set are hypothetical, odds are estimates").

## Async cross-team race guard
The open handler sets a loading shell (teamName/logo/side), then fetches and merges
the response. Guard the merge so a resolving fetch only writes if the CURRENT
selection still matches the side + gameLabel it was requested for
(`prev.loading && prev.side === side && prev.gameLabel === game`).
**Why:** a rapid Away→Home re-tap would otherwise merge one team's real stats under
the other team's identity — real numbers, wrong team = misleading.

## Wiring notes
- `realGameForGame` (game-detail IIFE) carries homeTeam/awayTeam, homeLogo/awayLogo,
  and homeTeamId/awayTeamId — everything the team page needs. Disable the tap when
  team ids are missing.
- Team-total odds use a SMALL line-vs-avg multiplier (~0.05) because totals are
  ~100+; the player page's 0.5 would blow odds to the cap instantly.
