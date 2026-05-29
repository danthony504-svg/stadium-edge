---
name: Anti-correlated period picks (mutually exclusive legs)
description: When the AI builds period parlays from a thin pool, it will combine legs that mathematically cannot both win (e.g. Team A 1H ML + Team B 1H -3) — these are anti-correlated, not just correlated. The same-side correlation rule does not catch them; need a separate explicit "mutually exclusive" rule with worked examples.
---

# Rule
Within a single game AND single settlement window (full-game, 1H, 2H, Q1-Q4), legs that mathematically cannot both win are BANNED. This is a stricter case than correlation:
- Correlated = leg A winning makes leg B ≥80% likely to win (redundancy; you're paying parlay juice to combine equivalent bets).
- Anti-correlated = leg A winning makes leg B IMPOSSIBLE or ≤20% likely (guaranteed loser; the parlay is dead on arrival).

The canonical anti-correlation failures the model produces:
- Team A's ML + Team B's spread at any positive number (same period). If A leads, B trails — B's -N cannot cash.
- Both teams' spreads on the same period at positive numbers (only one team can be ahead by N).
- Both teams' moneylines on the same period (only one team can lead a period).
- Team A's ML + Team A's spread on the OPPOSITE side (Thunder ML + Spurs +6 where Thunder is favored — Thunder winning by 7+ kills the dog spread).
- Over total + the team's lead-scorer Under (the over typically requires the lead scorer to deliver).

**Why:** The pre-existing correlation rule covered SAME-SIDE redundancy (Thunder ML + Thunder -3, Total Over + star points Over). It said nothing about opposite-team combinations because in full-game parlays those rarely show up — the AI naturally picks one direction per game. But once period markets were added, the pool per period is much thinner (often 1-3 viable legs per game per period), so the model started reaching across teams to fill the leg count, producing logically impossible tickets like "1H Thunder ML + 1H Spurs -3" — the user caught this in production.

# How to apply
- Write the anti-correlation rule as a separate HARD BAN block from the correlation rule. Don't append; the model treats new bullets under an existing rule as edge cases and applies the parent rule's heuristic. A standalone "MUTUALLY EXCLUSIVE" header forces re-evaluation.
- Enumerate every combo type explicitly with a worked numeric example. "Don't pick anti-correlated legs" without examples gets interpreted vaguely; "1H Thunder ML + 1H Spurs -3 is BANNED because…" gets followed.
- Include a SELF-CHECK clause: before emitting the ticket, for every pair of legs sharing game+period, ask "can both win in the same world?" Without this self-check the rule fires only when the model's parlay-construction pass thinks of it, not when reviewing the output.
- Make the rule recursive across periods (1H pick + full-game pick that contradicts the 1H outcome): allowed only when the period outcome doesn't force the game outcome — period leaders can lose games, but period blowouts can't.
- This is prompt-side only because a server-side detector would need to know which team is favored, the spread sign convention per book, and how to pair MLs with spreads — fragile. Prompt with worked examples scales better than encoding the matrix.

# Smell test
If a ticket combines two legs from the same game+period where one leg names Team A and the other names Team B, manually verify both can win simultaneously. If they can't, the rule is incomplete or being ignored — strengthen the example list, don't just re-emphasize the principle.

# Extension — full-game Total OVER + star scoring UNDERS (directional consistency)
The original rule scoped the "Over total + lead-scorer Under" case too narrowly (period-only, same-player). Production slip showed the FULL-GAME version across DIFFERENT stars: "Over 219.5" + "SGA Under 35.5 pts" + "Wemby Under 27.5 pts" + "Holmgren Under 22.5 PRA" — self-defeating (clearing the total needs the stars to score; in the low-scoring game the unders cash but the over dies).
**Fix applied (prompt-only):** broadened the anti-corr bullet to full-game + cross-player + points-inclusive (PTS, PTS+REB+AST), and added a LAST-STEP "DIRECTIONAL-CONSISTENCY PASS": per game, pick ONE scoring direction — a Total OVER forbids same-game scoring UNDERS and vice versa. **Exempt:** assists/rebounds/steals/blocks (don't scale tightly with the total) — only points/points-inclusive legs are bound.
**Why:** the model treated the narrow example as period/same-player-specific and didn't generalize. A worked numeric example matching the exact failing slip + a standalone final pass is what makes it stick (same lesson as the parent rule).

# Compliance note — why prompt framing matters here (no server-side option)
The /api/chat response is a PURE token stream (no buffering, client parses PICK: lines live), so server-side stripping of a contradictory leg is impractical and risks the auto-add parser — enforcement must be prompt-side. First prompt pass only half-worked: model made the star leg consistent but let a ROLE player's points under through and called the shorter slip "clean." What fixed it: (1) frame the directional pass as a "HARD GATE ON YOUR OUTPUT, not advice", (2) state it binds EVERY player regardless of star status, (3) add the EXACT failing example from the test ("Total Over 227.5" + "Dylan Harper Under 19.5"), and (4) explicitly say "dropping to fewer legs does NOT make a contradictory slip clean." Verified via e2e twice.
