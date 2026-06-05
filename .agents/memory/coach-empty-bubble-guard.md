---
name: Coach empty/invisible reply guard
description: Why a successful AI Coach chat (200) can render a blank bubble, and the rule for fixing it
---

# AI Coach empty/invisible assistant bubble

A parlay reply can come back 200 yet show NOTHING below the user message (blank,
invisible assistant bubble). This happens whenever the resolved pick set is empty
but the model still emitted `PICK:` scaffold lines:

- `parsePicks` fail-closes to `[]` when no emitted leg resolves to a real odds
  entry (board thin / between updates / odds 429).
- `assistantBubbleText()` strips everything from the first `PICK:` line onward,
  so the visible bubble text becomes empty.
- With `hasPicks === false` and `isWaiting === false`, the row renders nothing.

**Why:** the strip-from-first-PICK design assumes cards will carry the content.
When zero cards resolve, the stripped prose AND the cards are both empty.

**Gotcha:** a note appended AFTER the `full` text (e.g. `full + thresholdNote`)
also sits after the `PICK:` lines, so `assistantBubbleText` strips the note too —
appending is NOT enough to make the message visible.

**How to apply:** any "no legs resolved" honesty note must REPLACE the unbacked
scaffold, not be appended after it. Build the final content as
`assistantBubbleText(full, false)` (lead-in prose only) + note, and add an
absolute backstop: if `picks.length === 0` and the visible bubble would still be
empty, replace content with a plain fallback sentence. Count emitted PICK lines
by the pipe-delimited shape (`/^PICK\s*:.*\|.*\|.*\|/`), same as parsePicks /
buildingLegCount, so prose merely containing "PICK:" never trips the note.
Mirror this in web ParlayBuilder if the same blank-reply path exists there.
