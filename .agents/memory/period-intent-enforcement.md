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

# Mixed-period requests
Users mix periods in a single ask ("10 leg first half and 1 quarter parlay"). Period intent must therefore be a SET (q1 and/or h1), not a single value. A single-value detector silently drops one of the two intents and then filters the pool to that single suffix, returning empty when the surviving period has no markets for the requested sport (NBA has _q1 but no _h1). All downstream branches — market-lock allow-list, server-side suffix filter, fresh-fetch fallback, system addendum text — must iterate the suffix set, not a scalar. Also: the trigger regex must accept bare "1 quarter" / "1 half" (not just "first quarter"), because users type it that way.

# Layer 4: server-side fresh-fetch fallback
Even with the 3-layer enforcement, the client's incoming `realProps` can be empty of period markets — typically because the client cache pre-dated the QH catalog deploy and the user's browser (mobile Safari especially) is still on stale JS, so client-side cache-bust never runs. Don't trust the client. When period intent is detected AND the post-filter `realProps` is empty AND `realOdds` contains games in QH-supported sports (`nba/nfl/ncaaf`), self-fetch `/api/sports/odds` to resolve event IDs from the incoming `Away @ Home` game labels, then self-fetch `/api/sports/props` for up to N (5) events per sport in parallel, and substitute the suffix-matching rows into the locked context.

**Why:** Client cache freshness is fundamentally outside the server's control. The fallback is cheap because both endpoints are server-cached ~5min, errors at every level are non-fatal, and the AI then picks from real fresh data instead of honestly reporting an empty pool. Verified end-to-end: a payload with `realProps: []` returns a real `1Q Assists` PICK for the matching game.

**How to apply:** Self-fetch via `http://127.0.0.1:${PORT}` to stay in-process. Gate the fallback strictly on `filteredProps.length === 0` so healthy clients bypass the cost. Match games by canonical `Away @ Home` label (the format used everywhere client-side). Map prop fields to the chat-payload shape (`over`/`under`, not `overPrice`/`underPrice`). Note: enrichment fields like `opponentTeamId` are dropped on the fallback path, so per-leg defense edge notes will be thinner — accepted tradeoff vs. zero data.

# ALT swap suggestions in ticket output
After the PICK + EDGE block of every ticket, the AI must emit 2-3 `ALT:` lines suggesting swap candidates the user can take to improve the ticket. Format: `ALT: <Game> | <Market> | <Selection> | <Odds> — swaps leg <N>, <reason>`. The `ALT:` prefix MUST be distinct from `PICK:` because the client auto-add parser matches `^PICK:` and would otherwise auto-stake the alternates. The prompt also forbids the literal token `PICK:` anywhere inside an ALT line (the non-anchored secondary parser at the slip-fill path can mid-line match a stray `PICK:` and cause double-adds). Alts must come from the SAME real pool as the picks — `realOdds` for sides/totals, `realProps` for props — never invent. When the live pool is too thin (one game, no alts), the AI says so honestly on a single `ALT: no meaningful swaps in tonight's pool` line rather than padding with low-quality fills.

**Why:** Just showing the recommended legs is one-shot — the user wants to see swap options ("would buying off the key number help?", "is there a juicier alt rung?") without re-asking. Putting it inline keeps the conversation single-turn for the most common follow-up.

# Smell test
If the AI returns a "1Q ticket" that includes any game-level spread/total/ML or any full-game player prop, the layering is incomplete. Prompt-only fixes will look like they work on the next test and silently regress on the one after.
