---
name: Prop-detail real FACTORS cards
description: How the mobile prop-detail "FACTORS TO WEIGH" cards render real data vs honest fallback, and the season-average trick.
---

The mobile prop-detail FACTORS cards (`app/prop/[id].tsx` + `lib/propFactors.ts`)
are DUAL-MODE: each card renders REAL numbers when the page passes a `real:
RealPropSignals` block, else falls back to the original generic "check this"
guidance. The honesty test in `propFactors.test.ts` only bans numbers in the
GENERIC path (called without `real`); real cards intentionally print fed values.

**Season-average trick (recent-vs-season):** there is no per-market season helper.
Reuse `gameValueForMarket(marketKey, stats, ambiguous)` by passing
`seasonSummary.averages` stringified as the `stats` arg — avg-of-a-sum equals
sum-of-averages, so combos (PRA) and total_bases stay exact. Same label set =>
`ambiguous` still applies.

**MLB batter joins (fail-closed):** opponent->probable pitcher uses
`oppName -> oppTeamId -> probables[oppTeamId]` (the OPPONENT's starter, not the
player's). Require EXACTLY ONE of home/away nickname to match `oppName` or a
shared nickname (Red Sox vs White Sox) mis-attributes — fall back to generic.
Platoon side is hand-selected (`throws==="R"?vsRight:vsLeft`); ballpark/weather is
keyed by the HOME team id and is side-independent. Endpoints (already existed):
`/sports/mlb-probables`, `/sports/mlb-batter-splits`. Dome => weather-neutral,
never invent wind.

**Why:** keeps one market->stat source of truth, and guarantees every printed
number is a real feed value or deterministic derivation (fail-closed honesty).
