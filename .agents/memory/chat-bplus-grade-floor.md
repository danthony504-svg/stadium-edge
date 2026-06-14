---
name: Chat default grade floor — D to A+ (prefer high, never-empty)
description: AI Coach PREFERS strong-edge picks but shows the full honest grade range D to A+; floor is at D (drops only F/ungradeable when stronger legs exist), never empty.
---

# Default chat pick-quality grade floor (D to A+, never-empty)

**Current user decision (latest, do NOT revert to a B+ floor):** the Coach shows
the **full honest grade range D to A+** — it must NOT hold the ticket to B+ and
up. A 9-leg request should fill out across the real grade spectrum (D / C / B /
A …), not collapse to the couple of B+ legs the board happens to support. The
model still PREFERS the strongest-edge legs (and leans on real alt rungs to lift
grades), but lower-but-real grades are fine to show. The client floor is now at
**D (composite ≥ 4.0** in `pickScore.ts` `gradeFromComposite`); it only drops a
resolved leg that grades below D (an F) or can't be graded at all (composite
null) — and only when stronger legs exist. Never inflate a grade.

(History: this was a B+ floor at composite ≥ 7.5; the user explicitly relaxed it
to "it's okay to give other grades in chart D to A+". Don't re-tighten to B+.)

Strict-drop only removes sub-D / ungradeable legs *within* a ticket that still
has ≥1 D-or-better leg (with a count note). Drop-to-EMPTY never happens.

Implemented with the project's standard **"server prompt steers + client hard-filters"**
pattern (same shape as confidence-threshold-lock / odds-threshold-parlay /
alt-sign-request).

- **Server (chat.ts SYSTEM_PROMPT):** a "DEFAULT PICK-QUALITY — PREFER HIGH,
  GRADES D TO A+ ARE ALL OK" paragraph after ALTERNATE LINES — prefer
  strongest-edge legs + real alt rungs, but show the full D-to-A+ range, don't
  hold to B+; NEVER refuse / empty: fill the requested count with the best real
  legs, note when some land in lower grades, never fabricate edge.
- **Client (mobile coach.tsx):** `gradeFloorActive = !oddsThreshold && !confidenceThreshold && !wantsLongshot`.
  When active + `emittedPickLines>0`: partition into `passed` (composite ≥ **4.0**,
  i.e. D-or-better) sorted by composite desc. If any pass → keep ONLY those
  (sorted) + "dropped N" note only when sub-D/ungradeable legs were removed. If
  NONE pass but `before>0` → keep ALL resolved picks sorted by composite desc
  (null → -Infinity, sinks last) + `gradeLegNote` "Here are the N strongest legs…
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
number/bigger cushion, so the pick earns a higher grade. Still real rungs only,
never shade/invent a line. No client change needed: the never-fabricate matcher
resolves the emitted alt rung back to its real realOdds entry, so the
higher-graded rung survives the composite≥4.0 (D) filter; only sub-D / ungradeable
legs get dropped.

## Transparency gotcha (caught in review — don't regress)
The assistant bubble is SUPPRESSED for any message with picks
(`assistantBubbleText(..., hasPicks)` → ""). So a markdown note appended to
`finalContent` is INVISIBLE when picks remain. The only visible channel beside
the cards is `m.legNote` (plain text).

Both grade-floor branches now keep ≥1 pick, so they BOTH use the plain-text
`gradeLegNote` (fed into `legNote`, supersedes the generic "you asked for N legs"
count). The old markdown `gradeNote` var was REMOVED (it only existed for the
drop-to-empty branch that no longer happens) — don't re-add it.

**Null composite** (pure market-price play, no stated edge) can't clear the D bar,
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
