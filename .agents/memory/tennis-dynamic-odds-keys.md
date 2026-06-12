---
name: Tennis Odds API keys must be resolved dynamically
description: Why the Tennis tab goes empty between/after majors and how the odds route follows the live calendar
---

# Tennis tab shows "No games" even when tennis is being played

**Symptom:** the mobile/web Tennis tab shows "No Tennis games are within the next
48 hours" while sportsbooks clearly have live ATP/WTA matches (e.g. grass-court
warm-ups after Roland-Garros).

**Root cause:** unlike NBA/NHL/MLB (one stable sport key), the Odds API has a
SEPARATE key PER TOURNAMENT — `tennis_atp_french_open`, `tennis_wta_wimbledon`,
`tennis_wta_queens_club_champ`, … — and only the tournaments being played right
now are flagged `active: true`. The config used to hardcode a single major's two
keys (`tennis_atp_french_open`, `tennis_wta_french_open`). The moment that major
ends, those keys return zero events and the tab is empty until someone manually
edits the keys for the next tournament. There is NO generic "all tennis" key.

**Fix:** resolve tennis keys DYNAMICALLY. `resolveOddsKeys(sportId)` in
`api-server/src/lib/sports.ts` fetches the Odds API sports list
(`/v4/sports/?apiKey=…`, cached ~30 min), keeps the entries with
`active === true` whose key starts with `tennis_atp`/`tennis_wta`, and fetches
those — so the tab always follows the live calendar. The odds route calls
`await resolveOddsKeys(sportId)` instead of reading the static array. Every other
sport returns its static key(s) unchanged.

**Fail-safe:** no `ODDS_API_KEY`, list fetch error, or zero active tennis keys →
fall back to the static keys. The static `ODDS_SPORT_KEYS.tennis` entry is kept
ONLY as that fallback.

**Scope notes:**
- Tennis is moneyline (h2h) ONLY by product rule, and tennis is NOT in
  `MARKETS_BY_SPORT`, so `props.ts` returns empty for tennis before it ever uses
  the keys — no need to wire the dynamic resolver there. The list endpoint
  (`/api/sports/odds`) is the only consumer that matters.
- Each active tournament is a separate cached, best-effort key fetch (same
  fan-out/merge pattern as soccer), so one dead tournament can't wipe the others.
- Same class of bug could hit any other per-tournament/seasonal Odds API sport if
  added later — prefer dynamic active-key discovery over hardcoding a season.

**Reminder:** api-server has NO watcher — restart `artifacts/api-server: API
Server`, then verify with `/api/sports/odds?sport=tennis`.
