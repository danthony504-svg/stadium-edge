---
name: Coach last-meeting / series takeaways
description: How the AI Coach answers "what did we learn from the previous game (Game 2) that helps next game" using real data only.
---

# Coach "what did we learn last game" takeaways

The Coach can answer last-game → next-game / "Game 2 → Game 3" / series-adjustment
questions, grounded ONLY in the real box score of the two teams' MOST RECENT
completed meeting. Source of truth: `GET /sports/matchup-history` now returns a
top-level `lastMeeting` (real-or-null).

**Data path:** `fetchGameBoxScore()` in api-server `routes/history.ts` fetches ESPN
`/summary?event=<eventId>` for `h2hRaw[0]` (the most recent prior meeting, which
already carries an `eventId`), and reduces to real `boxscore.teams[].statistics`
(team totals) + real `leaders[]` (statistical leaders). Returns null on any
failure/empty (fail-closed). The route attaches `lastMeeting` only when the teams
have actually met before → one extra ESPN fetch only for repeat opponents, and the
whole route is cached 15min. Mobile `lib/api.ts buildMatchupHistoryAndUpsets`
passes `data.lastMeeting` through into each `matchupHistory[label]` entry, so it
reaches the Coach context. Prompt rule lives in `chat.ts` SYSTEM_PROMPT
("LAST MEETING / WHAT DID WE LEARN RULE").

**Why / invariants (don't regress):**
- HARD never-fabricate: use ONLY labels/values present in `lastMeeting` + scores in
  `h2h.meetings`. If `lastMeeting` is null but `h2h.meetings` exists, give
  score-level takeaways and SAY the box score isn't available — never invent
  player lines / minutes / foul trouble / shooting %.
- HONEST SERIES FRAMING: the app knows the most recent MEETING, not the playoff
  series game number, and doesn't know it's a series at all. Frame as "their most
  recent meeting (date)" — never assert "Game 2 of the series" unless the USER says
  so. (This is the exact thing the original honest refusal was protecting.)

**Web parity gap:** only the MOBILE Coach context was wired. The server `lastMeeting`
field is available; web ParlayBuilder's own context builder would need the same
passthrough to use it (not done — user was on mobile).
