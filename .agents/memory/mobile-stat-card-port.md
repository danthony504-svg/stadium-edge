---
name: Mobile AI Coach stat-card port
description: The mobile app has its own parallel stat-card chat surface mirroring the web ParlayBuilder one — stat-lookup changes must hit BOTH.
---

# Mobile AI Coach stat-card port

The Expo app (`artifacts/stadium-mobile`) renders player/period stat questions in
the AI Coach chat as rich cards, mirroring the proven web behavior in
`artifacts/stadium-edge/src/ParlayBuilder.tsx` (parseStatLookup + PlayerStatCard +
PeriodGameLogCard). The mobile copy lives in:
- `lib/statLookup.ts` — RN port of parseStatLookup + the STAT_TABLE_COLS / STAT_SUMMARY / MLB_PITCHER maps.
- `components/PlayerStatCard.tsx`, `components/PeriodGameLogCard.tsx` — RN card UIs.
- `app/(tabs)/coach.tsx` — `tryStatCard()` intercepts in `send()` BEFORE the chat stream; on any miss/error it falls through to the normal (never-fabricating) AI path.

**Why this is a sync point:** a stat-lookup behavior change (new stat word, new
period type, label/summary map edits, never-fabricate rules) now has TWO homes —
web ParlayBuilder.tsx and mobile lib/statLookup.ts. Changing only one leaves the
platforms inconsistent. This is the same "duplicate surface" trap as the
mockup-sandbox ParlayBuilder, except this mobile copy IS live (unlike mockup).

## Period detection design (decided here)
- `period` (boolean) is BROAD: any quarter/half/period/inning token → true. Drives
  the honest "period splits aren't in ESPN game logs" note on the ESPN player card.
- `periodPhrase` (string|null) is BEST-EFFORT and precise (e.g. "first quarter",
  "second half", "first period", "third inning"); only when set do we route to the
  StatMuse per-game grid (`getStatmuseGamelog`). If period but no phrase → ESPN
  player card with the honest full-game-only note.
- **Why decoupled:** lets us truthfully flag period intent even for phrasings we
  can't turn into a clean StatMuse query, instead of silently showing full-game
  numbers as if they answered the period question.

## Name-recovery span search (parity gap that bit us)
- Forward-looking phrasings ("how many points will X score tonight?") leave a
  stray filler word on the extracted name (e.g. `"Wembanyama will"` — "will" is
  deliberately NOT stripped because "Will Smith"). ESPN's strict player-search
  then returns [], so the stat card silently fails and the coach answers from
  generic chat context only (looked like "no real data for X").
- **Fix/decision:** mobile `tryStatCard` now mirrors web's span-search fallback —
  on a first-search miss (and not `bareName`), retry contiguous sub-spans of the
  name longest→shortest, skip single tokens in `NAME_FALLBACK_SKIP`, accept a hit
  only if the candidate is contained (accent-insensitive) in the resolved name.
  `BARE_NAME_STOP` + `NAME_FALLBACK_SKIP` are exported from mobile `statLookup.ts`.
- **Why it's safe for real names:** "Will Smith" resolves on the FIRST search, so
  the fallback never runs for it; the containment guard blocks wrong-athlete fuzzy
  binds. Any future name-recovery change must hit BOTH web ParlayBuilder and
  mobile coach.

## Team stat lookup (mobile-only — web has NO team card)
- The coach now also answers TEAM questions ("Lakers stats", "how are the Celtics
  doing") with a real ESPN team card. This is a FALLBACK inside the SAME
  `tryStatCard`: player search (+ span search) runs first; only on a player MISS
  (`!top`) do we `searchTeam(lookup.name)` → `getTeamHistory(sport, teamId)`. A
  team miss returns null → AI fallthrough. Player-first ordering is what prevents
  a player query from being hijacked to a team.
- Backend lives in `artifacts/api-server/src/routes/history.ts`: `/sports/team-search`
  (ESPN `type=team`, league→sport map, ranks pro over college) and
  `/sports/team-history` (reuses the team-form reducers; **off-season fallback**:
  if the current schedule has 0 decided games it retries `?season={prevYear}`, so
  NFL/NCAAF show last season's real results with an honest "no games yet" note).
- **Sync asymmetry to remember:** unlike player/period lookup, the web
  ParlayBuilder has NO team-card path — this is mobile-only. Don't assume a web
  counterpart exists when changing it.
- `searchTeam`/`getTeamHistory` + their types are in mobile `lib/api.ts`; card UI
  is `components/TeamStatCard.tsx`; `serializeStatCardForAI` has a teamCard branch
  so projection questions ("are the Lakers a good bet tonight?") get the real
  form/streak/recent-scores block, never invented numbers.

## Other gotchas
- Player resolution uses ESPN relevance-first (`results[0]`), NOT "prefer any
  active player" — the active-override returned the wrong athlete for
  historical/retired queries.
- `getPlayerHistory` in mobile `lib/api.ts` takes an ARGS OBJECT
  `{sport, athleteId, season?, opponentName?}` (web/old mobile was positional);
  `PlayerPropsSheet.tsx` is the other caller that must use the object form.
- Verify cards without typing: coach screen auto-sends via `?prefill=...&send=1`
  query params — screenshot that URL.
