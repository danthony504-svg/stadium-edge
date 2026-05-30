---
name: Betting value signals on chat cards (no-vig / +EV / key #s / line shop)
description: How the no-vig fair line, cross-book +EV, key-number, and line-shopping signals on chat pick cards are computed and gated.
---

# Market-inefficiency signals on AI-chat pick cards

User asked the app to "find betting inefficiencies and use them for picking."
Implemented as `valueSignals(pick)` (defined near `lookupGameStart`/`formatGameTime`)
returning `{ fairAmerican, fairProb, vigPct, evPct, bestBooks, keyNote }` or null.

**Data boundary (critical):** everything is derived ONLY from real bookmaker
prices already in `realOddsBySport` — both sides of the market plus each
outcome's per-book `books` array `[{book,price,point}]` (sorted best-first by
the API). Nothing is invented. Props return no `books` array and period legs
have no full-game both-sides data, so `valueSignals` returns null for props /
period / unresolvable markets and those cards stay clean. Only full-game
Moneyline / Spread / Total are handled.

**Math:**
- No-vig fair: `impS=impliedProb(sideBest)`, `impO=impliedProb(oppBest)`,
  `fairProb=impS/(impS+impO)`, `fairAmerican=probToAmerican(fairProb)`,
  `vigPct=(impS+impO-1)*100`.
- Cross-book +EV (genuinely non-circular): consensus true prob from the MEDIAN
  price of EACH side across its books, then `evPct = consensusFair *
  americanToDecimal(sideBest) - 1`. Flag green "+EV" only when `evPct >= 0.5`.
  This surfaces the line-shopping inefficiency: best book beats de-vigged
  consensus. Comparing a price to its OWN de-vig is circular — must use the
  cross-book consensus vs the best price.
- Line shopping: reuse existing `BookCompare` component (was only on
  game-detail picks) by passing the resolved outcome's `books`.
- Key numbers: football only (`/^(nfl|ncaaf|cfb|college)/`), spreads only,
  on/near 3 and 7 (secondary 6/10/14). No key-number concept for other sports.

**Pick -> outcome resolution gotcha:** the AI's `pick.pick` string uses varied
team forms ("Bills ML", "Buffalo Bills -2.5"). Resolve by stripping the trailing
` ML` / signed number to a team token, then match outcome.name with
`expandTeamToken` + lowercase + strip-non-alnum + bidirectional `includes`
(handles nickname-not-in-map). Totals matched by over/under regex. Game found
via tolerant `gameLabelsMatch`. Opp = the other outcome in the market.

**Why median for EV, not mean:** robust to a single off book; one stale/outlier
line shouldn't fake a +EV flag.
