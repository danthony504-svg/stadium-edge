---
name: HR Green/Red Flags checklist
description: How the mobile HR prop-card flag checklist mirrors the user's HR rubric, what it can't honestly evaluate, and why it renders independently of the HR Target Score.
---

# HR Green/Red Flags checklist

A scannable green/red flag list on the mobile HR prop card (`app/prop/[id].tsx`),
driven by pure `lib/hrFlags.ts` (`computeHrFlags`), mirroring a user-pasted betting
rubric. Complementary to (NOT part of) the 7-weight `hrScore` — flags are a separate
checklist, the score is a weighted blend.

## Honesty boundaries (the durable part)
- **Wind direction is NOT in the feed** — weather carries wind SPEED only (`windMph`).
  So the rubric's "wind blowing out / blowing in" flags CANNOT be honestly evaluated:
  both are OMITTED and a transparency note is shown (`windOmitted = dome === false`,
  i.e. only on outdoor parks where wind would matter).
- **No true ground-ball % feed** — the "ground-ball pitcher" red flag is derived from a
  LOW `flyBallPct` (≤0.35), labelled "Ground-ball lean", never a fabricated GB%.
- **Statcast barrel/hard-hit allowed are gated on sample** — only light when
  `battedBallEvents >= 40` (same gate as the HR Target Score).
- A value BETWEEN the green and red threshold lights NOTHING; any missing datum is
  silently skipped. Never a guess.

## Render decoupling (avoid a regression)
The flags card renders **independently** of `hrScore` (`{hrFlags ? <HrFlagsCard/> : null}`),
NOT nested inside the score card.
**Why:** `oppOPS` and `kPer9` are flag-only inputs — the weighted score never weighs
them — so a starter with only those two values yields a null score but real flags.
Gating the checklist behind `hrScore` would hide it in that case. Guarded by a unit test.

## Prompt/card alignment
`api-server/src/routes/chat.ts` HR rule shares the SAME thresholds as the card so the
Coach and the card agree (HR/9 1.4/1.0, oppOPS .750/.650, flyBall .45/.35, K/9 7.0/9.0,
barrel 8 / hard-hit 40 green-gated on sample, park 105/95, cold ≤50).
**Caveat:** the card shows barrel/hard-hit ONLY as GREEN flags (the rubric lists no red
Statcast flag); the prompt may still treat a low-contact starter as an extra UNDER lean
but must NOT claim the card surfaces it as a red flag. The K/9 strikeout signal was the
one genuinely-missing factor added to both. Restart api-server after prompt edits (no watcher).
