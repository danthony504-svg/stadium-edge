---
name: Parlay — no duplicate market×game combos
description: Why the chat AI must never stack main + alt on the same game / same direction, and why deep-favored alts (-1000 or worse) are banned as filler.
---

Once alt-spreads and alt-totals were added to realOdds, the AI started returning tickets like "Over 218.5 (-115) + Alt Over 191.5 (-3500) + Alt Over 192.5 (-2400)" — three picks on the same game's total, all on the same side, two of them so deep-favored they were mathematically equivalent to the main line.

**Rules now hard-banned in chat.ts SYSTEM_PROMPT:**
1. At most one leg per (game, market family) where market families are: Moneyline / Spread+AltSpread / Total+AltTotal / specific player+stat combination. Main + alt on the same side of the same game is a duplicate, not two picks.
2. No alt-line leg priced -1000 or worse — at those odds the alt is mathematically equivalent to the main line and just dilutes parlay payout while masquerading as a "different" pick.

**Why:** alts were originally meant as a *substitute* for the main line when a different rung had better risk/reward, not as additive legs. Without an explicit ban, the AI would happily stack them because each one technically satisfied "real edge over priced implied probability".

**How to apply:** any future expansion that adds new alt market families (alt player props, alt period totals, alt team totals) MUST extend the family-grouping clause in the HARD BAN block so the dedup rule covers them too. If you see the AI returning two legs from the same game on closely-related markets, the bug is almost certainly that the new market wasn't added to the family list.
