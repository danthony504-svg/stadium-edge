---
name: "combo" means combo-prop market (not a parlay synonym)
description: How chat.ts routes the word "combo" — locks to combo props except in tight parlay-synonym forms
---

# "combo" routes to the combo-PROP market in this app

chat.ts `MARKET_KEYWORDS` has a generic `combo(s)` entry that locks the pool
to the multi-stat combo PROP markets (Pts+Reb+Ast / Pts+Reb / Pts+Ast /
Reb+Ast) — the sportsbook "Combos" tab.

**The decision (user-confirmed):** when a user says "combo" they mean the
combo-PROP market, INCLUDING "a 10 leg combo for tonight's NBA game". They do
NOT mean "a 10-leg parlay of single-stat props". A user who wants a plain
multi-leg ticket says "N-leg parlay" WITHOUT the word "combo".

**Why:** a user explicitly asked for "a 10 leg combo" and was unhappy to get
single-stat legs; they confirmed (choice query) that "combo" should mean
combo-prop legs. An earlier iteration had guarded the entry to SKIP locking
when "combo" followed "leg(s)" (treating "10 leg combo" as a parlay synonym) —
that guard is what produced the wrong single-stat ticket and has been removed.

**How to apply:** the entry locks for "combo"/"combos" in essentially every
phrasing EXCEPT the tight parlay-synonym forms, which stay unlocked:
`combo parlay`, `combo bet`, `combo ticket`, `parlay combo`. Regex:
`/(?<!\bparlay[\s-])\bcombos?\b(?!\s+(?:parlay|bet|ticket))/i`. Specific named
combos ("pra", "pts+reb") still match their earlier, more-specific entries
first. If the slate carries no combo markets (combos are NBA/WNBA only), the
server's <5-distinct-player fresh-fetch fallback + honest-short behavior
degrade gracefully — never fabricate.

**Scope:** server-only (chat.ts). The web client and mobile have no combo
keyword replica, so only chat.ts needed the change. Tradeoff: an ambiguous
"combo" with no ticket word on a non-NBA/WNBA slate now honestly returns
short/empty rather than building a generic parlay — intentional.
