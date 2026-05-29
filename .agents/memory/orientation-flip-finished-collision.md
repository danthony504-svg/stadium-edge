---
name: Home/away orientation flip → finished-game collision
description: Why the chat AI mislabels an upcoming game as "Today" on an already-finished matchup — the AI reverses Away@Home and the flipped label collides with a different, already-final game in the feed.
---

Symptom: user reports the chat shows a PAST/finished game tagged "Today · 7:30 PM",
and/or "only market picks". The card's matchup is the REVERSE of the real upcoming
game (e.g. shows "OKC @ SAS" when the real upcoming game is "SAS @ OKC").

Root cause: the LLM reverses home/away in the `<Game>` field. In a playoff series
the same two teams play with BOTH orientations across the schedule, so the flipped
label "OKC @ SAS" EXACTLY matches a DIFFERENT, already-FINISHED game in the feed.
Then `lookupGameStart(flippedLabel)` resolves to the finished game's tipoff and
`formatGameTime` renders "Today 7:30 PM". The flip also defeats canonical
filtering — both orientations are "real" games, so `filterPicksToReal` passes the
flipped label through unchanged instead of correcting it.

**Why it's not a prompt-only or data-only fix:** the upstream odds/games endpoints
were clean (finished game excluded from odds, marked Final in games). The bad data
is MANUFACTURED at output time by the AI reversing two real tokens. No source-side
filter can catch it because the flipped string is itself a valid (finished) fixture.

**How to apply (two-layer fix):**
1. Prompt (chat.ts SYSTEM_PROMPT, near the FULL TEAM NAME RULE): an
   EXACT-ORIENTATION rule — copy the matchup string character-for-character in the
   same Away@Home order; never reorder/swap teams; a reversed label is a different
   game. Reduces flips at generation time.
2. Render guard (ParlayBuilder.tsx): `gameResolvesToFinal(label)` returns true when
   a label resolves ONLY to final/past entries (in realGamesBySport status/time,
   realOddsBySport past commenceTime) with NO live/future candidate. Suppress the
   chat pick card (`return null`) when EITHER `pick.game` (canonical) OR
   `rawPick.game` (AI raw) resolves to final. Check BOTH because the flip lives in
   the raw label and canonicalization may not undo it.

**Gotcha:** a live/in-progress or any future/scheduled candidate for the EXACT label
must short-circuit to "keep" (return false) before counting final evidence — a
playoff label legitimately has both a finished game-1 and an upcoming game-2 under
related labels, and live games must never be suppressed.

Accepted tradeoff: if the AI emits a genuinely wrong label that happens to resolve
only to a finished game, the card is dropped rather than shown mislabeled — safer
for the user than a "Today" tag on a dead game.
