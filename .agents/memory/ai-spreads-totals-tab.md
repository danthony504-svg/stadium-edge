---
name: AI Spreads & Totals tab reasoning
description: Why the game-detail spread/total "AI pick" must use matchup-history analytics, not de-vig price math, and how home/away side classification stays safe.
---

# Game-detail "AI Spreads & Totals" tab

The tab gives one AI call per main market (spread + total) on the game-detail screen.

## The trap: a price-only no-vig pick degenerates to "lowest-vig side"
For a 2-sided vigged market, the no-vig fair edge of EACH side = ip·(1−sum)/sum, and
since sum>1 (vig) BOTH edges are negative. So `best.edge > 0` is never true and the
pick always falls to the generic "lowest-vig side of this market" string — it just
selects the cheaper (lower implied-prob) side. That is NOT data/analytics, and users
called it out.

**Why:** de-vig math alone has no team signal; it can only rank the two posted prices.
**How to apply:** any "AI pick" surface that should show real reasoning must pull the
real recent-form analytics (matchup-history), not compute off prices.

## The fix (analytics-first, price fallback)
- A `useEffect` keyed on the open `gameDetail` fetches `/api/sports/matchup-history`
  into `gameDetailHistory` state (only when the ESPN game has home/away team IDs).
- Spread: project margin = `home.last10.avgMargin − away.last10.avgMargin`; for each
  posted spread side compute cover cushion = sideProj + parsed point; take the largest
  cushion. Reason cites both teams' L10 record/margin.
- Total: `combinedPace = (home.ptsFor+home.ptsAgainst+away.ptsFor+away.ptsAgainst)/2`
  vs the posted total line → lean Over/Under. Reason cites pace + both teams' for/against.
- When history is null/unavailable, fall back to a CLEARLY LABELLED de-vigged price
  pick ("recent-form data isn't available for this matchup"). Only `p.real` lines used.

## Why home/away side classification is safe (no name-mismatch bug)
Spread side = `p.teamFull === homeName`. `teamFull` is `o.name` from the odds entry;
the `game` string is `"${g.awayTeam} @ ${g.homeTeam}"` built from that SAME odds entry
in buildPicksFromOdds; `realGameForGame` (source of `homeName`) is found by exact-match
of that game string against the ESPN games feed. So when `realGameForGame` exists,
its homeTeam === the odds-feed home name === teamFull. If feeds disagree, the exact
match fails → realGameForGame null → homeName null → analytics returns null → honest
price fallback. No misclassification, no extra guard needed.
