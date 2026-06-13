---
name: Chat default B+ grade floor (never-empty soft fallback)
description: AI Coach PREFERS B+ to A+ picks but never returns an empty ticket — falls back to best-available legs labeled with their real grade; how the floor + transparency note are wired.
---

# Default chat pick-quality grade floor (B+ to A+, never-empty)

By default the AI Coach PREFERS picks it can honestly grade **B+ or better**
(composite ≥ 7.5 in `pickScore.ts` `gradeFromComposite`), leaning on REAL alt
lines/rungs to give each pick edge so it reaches the band.

**User decision (explicit, do NOT revert to strict-drop):** when NO leg can
honestly reach B+ on tonight's board, the Coach must NOT return an empty ticket
/ refusal. Instead surface the night's **best-available** legs ranked
strongest-first, labeled with their REAL grades (B / B- / "no edge" when
ungradeable). Never inflate a grade to fake a B+. ("Also do alt picks to reach
the goal" — alts are still the lever, the floor just never leaves you empty.)

Strict-drop only happens *within* a ticket that still has ≥1 B+ leg: those weaker
legs are dropped to hold the bar (with a count note). Drop-to-EMPTY is gone.

Implemented with the project's standard **"server prompt steers + client hard-filters"**
pattern (same shape as confidence-threshold-lock / odds-threshold-parlay /
alt-sign-request).

- **Server (chat.ts SYSTEM_PROMPT):** a "DEFAULT PICK-QUALITY FLOOR — AIM B+ TO A+"
  paragraph after ALTERNATE LINES — prefer real alt rungs for edge; AIM B+ but
  NEVER refuse to an empty ticket: if a leg can't reach B+ even with its alts,
  INCLUDE the best real version (fill the count), say some grade below B+, never
  fabricate edge. (Was "DROP it / return shorter" — softened to never-empty.)
- **Client (mobile coach.tsx):** `gradeFloorActive = !oddsThreshold && !confidenceThreshold && !wantsLongshot`.
  When active + `emittedPickLines>0`: partition into `passed` (composite ≥ 7.5).
  If any pass → keep ONLY those (+ "dropped N" count note). If NONE pass but
  `before>0` → keep ALL resolved picks sorted by composite desc (null → -Infinity,
  sinks last) + `gradeLegNote` "None reached B+ tonight, here are the N strongest…
  top grade {grade}. I won't inflate a grade." `attachPickScores` runs BEFORE this.

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

Both grade-floor branches now keep ≥1 pick, so they BOTH use the plain-text
`gradeLegNote` (fed into `legNote`, supersedes the generic "you asked for N legs"
count). The old markdown `gradeNote` var was REMOVED (it only existed for the
drop-to-empty branch that no longer happens) — don't re-add it.

**Null composite** (pure market-price play, no stated edge) can't clear the bar,
so it's dropped when ≥1 leg passes, but in the none-pass fallback it's KEPT
(sorted last) and its card simply shows no edge grade — never promoted/inflated.

## Markdown italic in coach notes (ChatMarkdown)
Coach notes wrap emphasis in `_italic_`, but `ChatMarkdown.renderInline` only
handled `**bold**`, so underscores leaked as LITERAL chars in the bubble. Fixed:
split regex now `/(\*\*[^*]+\*\*|_[^_\n]+_)/g`; `_…_` renders `fontStyle:"italic"`
with underscores stripped. Applies to ALL `_…_` notes (confidence/threshold/today/
fallback), not just the grade floor.

## Reaches published app only via OTA/new build
All of the above is mobile JS — dev fix ≠ published fix. Ship via EAS Update (OTA)
or a new build; OTA from HEAD is DANGEROUS (see ota-update-unsafe-appversion).
