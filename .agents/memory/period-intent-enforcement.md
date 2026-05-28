---
name: Period-intent enforcement for AI-built parlays
description: When the user explicitly asks for first-quarter / first-half picks, prompt rules alone are not enough — the AI will pad with full-game picks. Need layered enforcement: prompt rule + server-side realProps filter + period-aware market-lock allow-list REPLACEMENT (not extension).
---

# Rule
When a chat assistant is offered both full-game and period (quarter/half) markets in its context, an explicit user intent like "first quarter parlay" / "1Q" / "first half" / "1H" must be enforced by THREE layers, not by prompt instructions alone:

1. **Prompt rule** that names the trigger phrases and forbids full-game spread/total/ML + full-game props for the turn, and requires an honest short-ticket response when the period pool is too thin.
2. **Server-side realProps filter** that strips the context payload to only entries whose market ends in `_q1` / `_h1` for the requested period. This is the "even if the model ignores the prompt rule, it physically cannot pick a full-game prop" backstop.
3. **Period-aware market-lock allow-list** — when both a market keyword (points, passing yards, etc.) AND period intent are present, the lock must REPLACE the base allow-list with the period-suffixed variants, NOT extend it. Extending leaves full-game variants visible and the model will preferentially pick them because they have richer playerHistory.

**Why:** Prompt rules are advisory to the model and routinely lose to its training prior to "build a balanced ticket". The original failing case had the QH catalog and reasoning rules in the prompt but no hard intent enforcement, and the model still returned a 4-leg full-game ticket for an explicit "first quarter" request. Only after layering the server-side filter did the behavior become reliable.

# How to apply
- Trigger phrases must be a strict list (`first quarter`, `1Q`, `1st quarter`, `Q1`, plus 1H variants). Don't try to catch "early action" or other vague phrasing — those should fall through to normal handling.
- For market-only locks (e.g. "points parlay"), narrow bare-stat keywords like `points`, `pts`, `hits`, `rebounds` with a nearby-betting-context lookahead (within ~40 chars require `props|parlay|leg|over|under|line|ticket|<numeric>`). Bare `\bpoints\b` triggers on "key points to watch" and falsely locks the entire turn to player_points.
- For period intent WITHOUT a market keyword (the most common failing case — "4 leg first quarter parlay"), apply the suffix filter on realProps unconditionally as an `else if` branch from the market-lock path.
- Mirror the server filter in the system addendum text — tell the model "you are receiving only period-suffixed markets, full-game variants are FORBIDDEN this turn". Without the addendum, even a correctly-filtered context can be misinterpreted as "the pool happens to be small, pad with full-game from realOdds".
- Refuse honestly for sport+period combinations that don't exist in the feed (e.g. NBA 1H, all NCAAB/MLB/NHL periods) rather than returning a 0-leg or padded ticket.

# Smell test
If the AI returns a "1Q ticket" that includes any game-level spread/total/ML or any full-game player prop, the layering is incomplete. Prompt-only fixes will look like they work on the next test and silently regress on the one after.
