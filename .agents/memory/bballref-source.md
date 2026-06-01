---
name: Basketball-Reference stat source (NBA)
description: How basketball-reference.com is wired in as a REAL NBA stat source, the player-resolution fabrication trap, and why nba.com/stats is NOT usable.
---

# Basketball-Reference source (NBA only)

Added on user request alongside StatMuse. Lives in `lib/bballref.ts` +
`routes/bballref.ts` (`GET /api/sports/bballref?name=` → `{result|null}`),
consumed by the player stat card in ParlayBuilder (NBA players only, called with
the ESPN-resolved full name so the search 302s to the exact player).

## nba.com/stats is NOT usable here
`stats.nba.com/stats/...` blocks cloud/datacenter IPs — returns HTTP 000
(connection refused) from Replit even with the right Referer/Origin/x-nba-stats
headers. Don't try to integrate it; it will fail silently. bbref is the working
NBA structured source.

## Player resolution — the fabrication trap (the whole reason to be careful)
bbref search (`/search/search.fcgi?search=`) **302-redirects** straight to the
player page for an unambiguous name (trustworthy). For an ambiguous OR
**zero-result** query it returns an HTTP 200 results page. **A zero-result page
still lists "popular players" (Wembanyama, LeBron, …) in a sidebar** — so a
naive "first `/players/` link on the page" grab returns the WRONG player's REAL
stats, which is a fabrication (presenting some star's numbers as the answer).
**Fix / rule:** only extract a `/players/` link that sits inside a
`search-item-name` block (the actual result rows). No `search-item-name` → no
result → return null. Never fall back to any page-wide `/players/` link.
Two parsing gotchas inside that block: (1) **active players are wrapped in
`<strong>`** between `search-item-name">` and the `<a>`, so the regex must allow
an optional wrapper or it silently drops all current stars (LeBron, Jokić, Luka,
Giannis…). (2) results also include `/gleague/players/...` links — anchor the
href match to start with `/players/` so G-League entries don't match.

## Parsing
Per-game table is plain HTML `id="per_game_stats"` (NOT comment-wrapped like the
advanced tables). Season label is in `data-stat="year_id"` (format `YYYY-YY`);
games is `games` (fallback `g`). Walk rows, keep the last one whose year_id
matches `^\d{4}-\d{2}$` = most recent season. 6h cache (bbref updates slowly).

## Never-fabricate
Every number is parsed off the page; any miss (no player, no table, no season
row) → null and the card shows nothing. bbref/ESPN season averages may differ
slightly — that's real cross-source variance, shown side by side as
corroboration, not an error.
