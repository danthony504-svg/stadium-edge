---
name: Parlay — no duplicate market×game combos
description: Why the chat AI must never stack main + alt on the same game / same direction, and why deep-favored alts (-1000 or worse) are banned as filler.
---

Once alt-spreads and alt-totals were added to realOdds, the AI started returning tickets like "Over 218.5 (-115) + Alt Over 191.5 (-3500) + Alt Over 192.5 (-2400)" — three picks on the same game's total, all on the same side, two of them so deep-favored they were mathematically equivalent to the main line.

**Rules now hard-banned in chat.ts SYSTEM_PROMPT:**
1. At most one leg per (game, market family) where market families are: Moneyline / Spread+AltSpread / Total+AltTotal / specific player+stat combination. Main + alt on the same side of the same game is a duplicate, not two picks.
2. No alt-line leg priced -1000 or worse — at those odds the alt is mathematically equivalent to the main line and just dilutes parlay payout while masquerading as a "different" pick.

**Why:** alts were originally meant as a *substitute* for the main line when a different rung had better risk/reward, not as additive legs. Without an explicit ban, the AI would happily stack them because each one technically satisfied "real edge over priced implied probability".

**Correlation is the third leg of the dedup problem:** different market families on the same game can still be mathematically dependent — e.g. "Team ML + same team's Spread cover" (ML hitting guarantees the spread cashes; spread cashing without the ML still loses), "Total Over + star's points OVER on a 240+ projected game", "team spread + team-total over". The chat prompt now hard-bans any pair where one leg winning makes the other ≥80% likely to win. Especially important on the SCARCITY FALLBACK path where the AI only has one game to fill from — must still pick 3 INDEPENDENT legs (e.g. Spread + Total + a non-scoring player prop), not ML + Spread + Total on the same team.

**Two enforcement points — both must stay in sync:**
1. **AI prompt** (`chat.ts` SYSTEM_PROMPT): hard-ban one-per-(game, market-family) and ban alts priced -1000 or worse — governs anything the chat AI returns.
2. **Deterministic pick generator** (`ParlayBuilder.tsx` `buildPicksFromOdds`): the Odds API returns 15-30 alt rungs per side per game; rendering them all dumps duplicate cards into the UI (e.g. Over 191.5 / Over 192.5 / Over 193.5 stacked) regardless of what the AI does. The generator curates per side: filter rungs worse than -1000, then keep AT MOST ONE per (game, side) — the one with the best risk/reward (closest to even money). A game can still show both Over-alt AND Under-alt, just not multiple rungs on the same side.

**Why two layers:** the AI prompt only controls chat-suggested parlay legs; the deterministic generator controls the cards rendered in game detail and "best picks" lists. Adding the rule to only one of them leaves the other path broken — both must enforce the same dedup + juice cap.

**How to apply:** any future expansion that adds new alt market families (alt player props, alt period totals, alt team totals) MUST extend BOTH (a) the family-grouping clause in the chat HARD BAN block and (b) the per-side curation in `buildPicksFromOdds` so the dedup + juice-cap rules cover them too.
