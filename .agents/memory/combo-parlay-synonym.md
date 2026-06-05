---
name: "combo" parlay-synonym vs combo-prop market
description: Why a bare "combo" keyword must not market-lock the chat pool
---

# "combo" is BOTH a parlay synonym and a prop-market name

chat.ts `MARKET_KEYWORDS` has a generic `combo(s)` entry that locks the pool
to the multi-stat combo PROP markets (Pts+Reb+Ast / Pts+Reb / Pts+Ast /
Reb+Ast) — meant for the sportsbook "Combos" tab.

**The bug:** users also say "combo" to mean a parlay/combination of legs
("a 10 leg combo for tonight's NBA game", "combo parlay", "combo bet"). The
bare `\bcombos?\b` matched those, market-locked the context to combo props,
the server filtered realProps down to that sparse market → empty → the AI
honestly refused ("hard-locked to combo props only, realProps is empty, can't
build"). A normal 10-leg parlay request died.

**The fix:** guard the combo entry with lookbehind/lookahead so it does NOT
fire when "combo" is a parlay synonym — skip when preceded by leg(s)/parlay
or followed by parlay/bet/ticket/leg(s). Bare "combos"/"combo props"/"build
me combos" still lock to combo props; specific named combos (pra/pts+reb)
still match their earlier, more-specific entries first.

**Scope:** server-only. The web client's PROP_MARKET_KEYWORDS replica has NO
combo entry, and mobile has none either — so only chat.ts needed the change.
