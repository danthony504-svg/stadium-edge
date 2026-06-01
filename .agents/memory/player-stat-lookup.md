---
name: Player stat lookup (chat)
description: How chat looks up ANY player's real ESPN stats (recent + past season) without fabrication; working ESPN search endpoint + summary-aggregation gotchas.
---

# Player stat lookup in chat

Chat can show any player's real game log via a DETERMINISTIC path (no AI), so it never fabricates. `parseStatLookup` in ParlayBuilder intercepts intent in `sendMessage` BEFORE the parlay/AI path → `/api/sports/player-search` → `/api/sports/player-history` → assistant message carrying a `statCard` object → `PlayerStatCard` renders it.

## Working ESPN endpoints (verified)
- **Player search that WORKS**: `site.web.api.espn.com/apis/common/v3/search?region=us&lang=en&type=player&query=...` → `items[]` with `id`, `displayName`, `league`, `defaultLeagueSlug`, `teamRelationships[0].displayName`, `headshot.href`.
  - **The `mode=prefix` variant returns count:0 / empty — do NOT use it.** `apis/search/v2` also works but has a messier shape.
- **Seasoned game log**: `.../sports/<path>/athletes/<id>/gamelog?season=YYYY` returns the SAME shape as the current-season call. `filters[]` (name "season") gives `value` (resolved season) + `options[]` (all available seasons) — surface these so users know which seasons exist.
- Map ESPN `league` slug → our sportId (LEAGUE_TO_SPORT in history.ts). Only US-major + college map cleanly; **soccer/tennis/UFC have a different gamelog structure** so they're intentionally omitted from search results.

## Summary-aggregation gotcha (no fabrication)
Season summary tiles may ONLY sum/average **counting** stats (HR, PTS, REB…). A mean of per-game **rate** stats (AVG/OPS/FG%) is NOT the true season rate — never show a derived number you can't compute correctly. The per-game table still shows ESPN's own exact rate values verbatim. See `STAT_SUMMARY` / `STAT_TABLE_COLS`.

## Intent gate is best-effort
`parseStatLookup` returning null sends the message to the AI/parlay path, which could invent numbers. So keep the stat cues BROAD (stat nouns like points/yards/rebounds, "how many … score", "stats for X", season+year). Strip stat nouns, filler/connector words (for/of/the/in…), period qualifiers (first/quarter/1H/period), AND bare numbers from the extracted name. Parlay/bet keywords hard-block the gate first.

## Bare player names must trigger (a real failure mode)
A bare name with NO stat cue — user just types "Wembanyama" as a follow-up — used to fall through to the AI, which then refused ("no NBA data loaded"). Fix: when there's no cue, treat a short (1–3 token), purely-alphabetic, non-stopword message as a `bareName` lookup. Critical wiring: for `bareName` the handler must search ESPN FIRST and, only if a player resolves, commit (push user msg + show card); if no match, do nothing and fall through to the AI (no "couldn't find" flicker). Explicit-cue queries still show the honest "couldn't find" card. Keep a small stopword set (hi/thanks/ok/help/odds/live/parlay…) just to avoid pointless searches — non-names fall through harmlessly anyway.

## Granularity ceiling
The card shows per-GAME totals only. Quarter/period splits ("first-quarter points in 2025 & 2026") are NOT in the standard ESPN gamelog — don't promise them; the real game-log card is still the right answer over an AI refusal.

## Wiring notes
- Chat `messages` are in-memory only (not persisted) → safe to add a `statCard` field to a message object. Render branch: `m.statCard ? <PlayerStatCard> : renderAssistantMessage(...)`.
- player-history additions (`season`, `availableSeasons`, `seasonSummary`) are ADDITIVE — the existing parlay flow keeps reading `recent/vsOpponent/homeSplit/awaySplit` unchanged. Cache key must include the season.
- api-server has no watcher — restart it after route edits (see api-server-no-watcher.md).
