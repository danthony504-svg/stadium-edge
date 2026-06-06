---
name: Stat-lookup role-word hijack guard
description: Why parseStatLookup must bail on messages that LEAD with a generic position word (pitcher/hitter/batter…) instead of resolving it to a player.
---

# Stat-lookup role-word hijack guard

`parseStatLookup` (the deterministic single-player stat-card detector — duplicated in web `ParlayBuilder.tsx` and mobile `lib/statLookup.ts`) hijacked TEAM+MARKET requests. "pitcher strikeouts for brewers and cardinals" passed the `hasCue` gate (stat noun), got its stat/filler words stripped down to the role word "pitcher", and the span-search name fallback resolved "pitcher" to a real athlete surnamed Pitcher (NCAAF's Calvin Pitcher) → a college-football tackle stat card for an MLB props question.

**Why:** a generic position/role word ("pitcher", "hitter", "batter", "catcher", "quarterback", "qb", "goalie", "goaltender", "kicker") names a CLASS of players, not one player. It is a pool/market question for the AI/parlay path, never a one-player lookup. Same bug class as the existing `most likely → Isaiah Likely` and leading `who/which` guards.

**How to apply:**
- Two-part fix, kept in parity across BOTH parser copies: (1) a START-ANCHORED role-subject guard (after the who/which guard) that returns null when the message LEADS with a role word (optionally after generic qualifiers like the/best/top/which/today); (2) the role words (singular+plural) added to `NAME_FALLBACK_SKIP` so the span fallback never tries one as a standalone name.
- Anchor at START on purpose: a real player whose SURNAME is a role word ("Calvin Pitcher stats") must still resolve — only bail when the role word is the leading subject ("pitcher strikeouts …"). Documented intentional miss: a bare surname-only "Pitcher stats" routes to AI (rare, acceptable).
- Returning null is the correct destination: parseStatLookup should only claim deterministic single-NAMED-player lookups; team+market pool asks belong to the broader chat/parlay intent path (MARKET-LOCK handles "strikeouts" → pitcher_strikeouts there).
- Client-side only (mobile Metro + web Vite hot-reload; no api-server change, no restart). General rule: any new player-name extractor must be tested against role-word-led market phrasings, not just named-player phrasings.

## Sibling: game/matchup pool guard (team-nickname hijack)
Same hijack class via a different door: "home runs in the orioles and blue jays game today" had the span fallback bind the token "Blue" (from "Blue Jays") to NFL RB Jaydon Blue. Added a GAME/MATCHUP guard (both parsers) that returns null for a stat asked about a matchup.

**Gotcha — anchor it, don't match any "X and Y game":** the first cut (`<token> and <token> … game`) regressed legit combined-stat lookups ("lebron points and rebounds game log" → "points and rebounds game" matched). Fix = anchor to a matchup context: a preposition (`in|for|during|from`) before the `<team> and <team> … game/matchup` span, OR the literal `game/matchup between <team> and <team>`. Use `and/&` only, never `vs/against` (those are the legit single-player opponent syntax handled by opponent extraction).
**Why prep-anchored:** "<stat> and <stat> game log" has no preposition before the conjuncts, so it's excluded; "in the <team> and <team> game" is. Accepted misses: no-preposition/no-"the" phrasings still leak (rare). Validate every change against BOTH matchup pool asks and combined-stat single-player asks.
