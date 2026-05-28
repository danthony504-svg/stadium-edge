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
