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

## Other gotchas
- Player resolution uses ESPN relevance-first (`results[0]`), NOT "prefer any
  active player" — the active-override returned the wrong athlete for
  historical/retired queries.
- `getPlayerHistory` in mobile `lib/api.ts` takes an ARGS OBJECT
  `{sport, athleteId, season?, opponentName?}` (web/old mobile was positional);
  `PlayerPropsSheet.tsx` is the other caller that must use the object form.
- Verify cards without typing: coach screen auto-sends via `?prefill=...&send=1`
  query params — screenshot that URL.
