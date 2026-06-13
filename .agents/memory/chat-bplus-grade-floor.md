---
name: Chat default B+ grade floor
description: AI Coach default-only shows B+ to A+ graded picks, leaning on real alt rungs for edge; how the floor + its honest transparency note are wired.
---

# Default chat pick-quality grade floor (B+ to A+)

By default the AI Coach should only surface picks it can honestly grade **B+ or
better** (composite ≥ 7.5 in `pickScore.ts` `gradeFromComposite`), leaning on
REAL alt lines/rungs to give each pick edge so it reaches the band. Sub-B+ legs
are DROPPED honestly (shorter ticket + a visible note), never inflated.

Implemented with the project's standard **"server prompt steers + client hard-filters"**
pattern (same shape as confidence-threshold-lock / odds-threshold-parlay /
alt-sign-request).

- **Server (chat.ts SYSTEM_PROMPT):** a "DEFAULT PICK-QUALITY FLOOR — AIM B+ TO A+"
  paragraph after ALTERNATE LINES — prefer real alt rungs for edge, drop legs that
  can't honestly reach B+, never fabricate edge.
- **Client (mobile coach.tsx):** `gradeFloorActive = !oddsThreshold && !confidenceThreshold && !wantsLongshot`.
  When active + `emittedPickLines>0`, filter `picks` to `p.scores?.composite >= 7.5`.
  `attachPickScores` must run BEFORE this filter.

**Why client-only floor:** grades exist ONLY on mobile (pickScore composite).
Web ParlayBuilder has no grading, so the hard filter is mobile-only; the prompt
steers both surfaces.

**Exceptions that disable the floor (user opted into their own rules):** longshot/
lottery/moonshot (`wantsLongshot`), explicit odds/price band (`oddsThreshold`),
explicit confidence ask (`confidenceThreshold`).

**Market-pick "add points" rule (prompt-only):** for a straight market/game-line
pick (moneyline/spread/total) it is explicitly OK — and preferred over dropping —
to ADD POINTS, i.e. move to a real Alt Spread/Alt Total rung that buys a safer
number/bigger cushion, so the pick reaches B+ to A+. Still real rungs only, never
shade/invent a line. No client change needed: the never-fabricate matcher resolves
the emitted alt rung back to its real realOdds entry, so the higher-graded rung
survives the composite≥7.5 filter; if adding points still can't reach B+, the
filter drops it honestly.

## Transparency gotcha (caught in review — don't regress)
The assistant bubble is SUPPRESSED for any message with picks
(`assistantBubbleText(..., hasPicks)` → ""). So a markdown note appended to
`finalContent` is INVISIBLE when picks remain. The only visible channel beside
the cards is `m.legNote` (plain text).

Therefore split the note by branch:
- **picks remain after dropping some** → set a plain-text `gradeLegNote`, fed into
  `legNote` (it supersedes the generic "you asked for N legs" count).
- **floor drops ALL picks (picks.length===0)** → markdown `gradeNote`, surfaced via
  `finalContent` / the zero-pick `note` chain (bubble IS shown there).

**Null composite** (pure market-price play, no stated edge) cannot clear the bar
and is dropped too — honest, never promoted.
