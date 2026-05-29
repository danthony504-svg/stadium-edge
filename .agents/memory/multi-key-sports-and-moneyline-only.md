---
name: Multi-key odds sports + moneyline-only enforcement
description: How an app "sport" can fan out to several Odds API keys (soccer/tennis), and how to hard-enforce a winner-odds-only sport server-side.
---

# One app sport → many Odds API keys

The Odds API has no single "all soccer" key and splits tennis into ATP/WTA per
major. So `ODDS_SPORT_KEYS` (sports.ts) is typed `Record<string, string|string[]>`:
a sport maps to ONE key (most) or an ARRAY (soccer = several live leagues, tennis
= atp+wta of the active major).

**How the merge works (odds.ts):** normalize to an array, fetch each key (cached
per key, best-effort `.catch(()=>[])` so one dead/empty league doesn't wipe the
others), then `.flat()`. CRITICAL: every per-event alt/period fetch and its cache
key must use **the event's own `g.sport_key`**, NOT the first key — otherwise a
merged soccer/tennis event hits the wrong league endpoint = wrong-league data
bleed.

**Why:** picking which leagues to merge for soccer is a product call; individual
soccer leagues are often thin (1 game) late-season, so several are merged under
one tab. The Odds API sport keys themselves are the source of truth for what's
live — re-probe before adding a league.

# Moneyline-only sports (tennis) — enforce server-side, don't trust the feed

Tennis is winner-odds (h2h) ONLY by product rule: no spreads/totals/alt/period
markets, no player props, no team analytics. Do NOT rely on the upstream feed
happening to omit them. In odds.ts: `moneylineOnly = sportId === "tennis"` →
request `markets=h2h` only in the bulk fetch AND set `upcoming = []` so the
per-event alt/period fan-out is skipped entirely. Verified: tennis odds response
contains only the `h2h` market key.

props.ts returns `[]` for tennis automatically (no `MARKETS_BY_SPORT` entry).
chat.ts SYSTEM_PROMPT explicitly tells the AI tennis is moneyline-only so it
never invents props/analytics.

# Tennis was already wired as an individual sport in the client

Before adding tennis, ParlayBuilder.tsx ALREADY treated tennis/golf/nascar as
individual sports (the `indiv` flag ~line 7735 and `isIndividual` ~line 9152
list them alongside ufc/mma). So a new individual/2-competitor sport needs only:
SPORTS-array registration + SPORT_W weight + server odds — NO new display code.
Game label uses "X @ Y" (same as UFC), and buildPicksFromOdds with h2h-only
produces moneyline picks.

Odds-only sports (tennis, extra soccer leagues) have no ESPN path, so the home
page's ESPN endpoints (games/injuries/history/defense/teamPeriodStats) return 400
for them — caught client-side, shows as harmless console 400s. Do NOT add fake
ESPN mappings to silence them; that would fetch wrong-sport data. They're
bettable in their own Sport Detail tab (built from `realOddsBySport`), just not
on the ESPN-driven home Upcoming list.

# WNBA PrizePicks fallback intentionally omitted

WNBA mirrors NBA everywhere EXCEPT `PRIZEPICKS_LEAGUE_BY_SPORT` (props.ts). Its
real props come through the Odds API (verified). There is no VERIFIED WNBA
PrizePicks league id; guessing one would silently fetch a different sport's
projections = fabrication. So WNBA has no PP last-resort fallback rather than a
wrong one. Same principle for WNBA QH markets: only `player_points_q1` is probe-
confirmed, so don't add reb/ast Q1 (the QH batch is all-or-nothing — one bad key
422s the whole call and loses points_q1 too).
