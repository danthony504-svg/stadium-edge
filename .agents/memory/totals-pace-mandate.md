---
name: Totals pick — pace mandate + alt ladder swaps
description: Why the totals rule had to be promoted from "tiebreaker" to HARD MANDATE, and why every Total leg must come with alt-total alternates.
---

For full-game (and period) totals, the AI must compute combinedPace from matchupHistory.recent10 BEFORE finalizing the pick, and side opposite to it is forbidden, not just discouraged.

**Why:** The prompt previously had "Pace ≥4 above the line leans OVER" as a soft tiebreaker buried in a list of weighting guides. In a single-game scarcity ticket the AI ignored it and picked Under on a 224-pace team into a 218.5 line — exact pattern the user caught. Soft "leans" language reads as advisory and gets dropped under pressure (small pool, scarcity, "diversify the ticket"). HARD MANDATE phrasing with an explicit "PICKING UNDER WHEN combinedPace > line+4 IS A BUG" line is what holds.

**How to apply:**
- Promote the totals rule above the other matchupHistory weighting bullets and label it HARD MANDATE.
- Make the formula explicit: combinedPace = (homeTeam.ptsFor + homeTeam.ptsAgainst + awayTeam.ptsFor + awayTeam.ptsAgainst) / 2 — readers won't derive it from "combined pace" alone.
- Add a cross-check pointer to teamPeriodStats (q1+q2+q3+q4 sum = full-game pace from a second sample) so the AI has redundant signal.
- The "right call" when pace contradicts the side it wants to pick is to DROP the total leg, not flip it. Spell that out — otherwise it'll flip-flop instead of passing.
- The edge note must cite combinedPace + both teams' ptsFor/ptsAgainst, not just the conclusion. This makes wrong reasoning visible and self-correcting.

Related: alt-total ladder swaps must always appear in the ALTERNATE PICKS block when ANY total leg is in the ticket (full-game or period). Prefer opposite-side rungs first, then same-side different number. "Only one game posted" is NOT a reason to skip alts — that single game's alt ladders ARE real swaps.
