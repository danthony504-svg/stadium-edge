---
name: Mobile period markets in chat context
description: Why mobile Coach refused 2H/period tickets and the two non-obvious traps in fixing it
---

Mobile AI Coach used to honestly refuse period/2H/Qn tickets ("no real 2H legs in
the posted context") because its odds-context builder emitted only full-game mains
+ full-game alt spread/total. The server already fetches & merges game-level period
markets per event, and the web app emits them gated on a period/same-game intent —
mobile just never did.

Fix shape: an `includePeriods` flag, set from a period/same-game intent detector on
the user's text, threaded through the chat-context builder into the odds builder
(same pattern as the odds-threshold flag), which then emits period legs with the
same friendly labels the shared SYSTEM_PROMPT already documents ("1H Spread",
"Q3 Total", "Q2 Moneyline", "1H Alt Spread/Total"). No server/prompt change.

**Trap 1 — period family collapse (the real bug-magnet).** The slip parser's
market-family normalizer collapsed every period label onto the full-game family,
so a period MONEYLINE pick (selection "Team ML", byte-identical to the full-game
ML) could resolve to the WRONG line. Spreads/totals are saved by their numeric
point, but moneylines have no number — so the family MUST carry a period prefix
(1h:/2h:/q3:…) to stay distinct. Full-game markets keep no prefix; full-game alt
spread/total must still collapse to spread/total (disambiguated by point). Watch
the "h2h" moneyline word: an `h2`/`h1` token match needs word boundaries so "h2h"
never falsely reads as a 2H period.
**Why:** without this, period tickets silently mislabel/misprice legs — a
never-fabricate violation dressed up as a working card.

**Trap 2 — period markets are LIVE-only pregame (esp. NBA).** Books post 1H lines
pregame but usually NOT 2H/Q3/Q4 until the game is live. So a pregame "2H ticket"
can still legitimately be thin/empty even with the fix working. Empty pregame
period feed is NOT a bug — verify against whether the feed actually carries the
`*_h2`/`*_q3` keys before assuming the emit path is broken.

**How to apply:** any new period/SGP surface on mobile must (a) make the family
period-aware before emitting period legs, and (b) not treat an empty pregame
period feed as a failure.
