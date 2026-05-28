---
name: Betting-signal data boundary (what the picks engine can/can't honestly use)
description: Which advanced betting factors are supportable with current feeds vs. which would force the AI to fabricate, and why.
---

Stadium Edge's core invariant: the AI must NEVER cite data not present in the live context. So a requested "factor" can only become a prompt rule if it's pure math/judgment OR backed by data we actually fetch. Adding a prompt rule for a signal we can't feed = guaranteed fabrication (the exact bug users keep catching).

**Supportable now (pure logic/math or existing data) — added to SYSTEM_PROMPT "ADVANCED ANALYTICS":**
- Estimated vs implied probability (edge = own estimate clearing break-even). The AI's estimate is analysis, not invented data — legitimate.
- Parlay variance / break-even math.
- Key-number awareness (NFL 3 & 7) — only via real Alt Spread rungs in realOdds.
- Same-game positive correlation (SGP) — guidance only, must not override the anti-correlation/same-bet HARD BANS.
- Schedule/situational (rest, back-to-backs, look-ahead/letdown) — QUALITATIVE only; never state a specific rest-days number unless it's in context.
- Venue/altitude/turf/dome — qualitative stable facts only; never fabricate a home/road split percentage.
- Sample-size caution + regression flags — pure judgment over existing matchup/player data.

**NOT supportable without a new feed (explicitly BANNED in the prompt so the AI can't invent them):**
- Opening vs current line / line movement — needs line-history storage or Odds API paid historical endpoint.
- Reverse line movement, steam moves — need multi-book line tracking over time + sharp data.
- Bet% vs money% splits — needs a provider like Action Network; no free source.
- CLV / "beat the close" — buildable but needs PERSISTENCE (store line at bet time, compare to closing). Real feature, separate from prompt work.
- Cross-book vig/hold comparison — odds.ts fetches multiple US books but collapses to best-price-by-(name,point); exposing per-book lines is buildable but not currently in context.

**Why:** The Odds API call (odds.ts) uses `regions=us&markets=h2h,spreads,totals` (+ period markets per-event) and merges to best price — no opening line, no history, no bet%. ESPN/Bovada are fallbacks, same shape. So line-movement/sharp-money signals have zero backing data.

**How to apply:** If a user asks to "factor in" a market-sentiment/line-movement signal, do NOT add it as a prompt rule. Either wire the real data source first (and only then add the rule), or tell the user it needs a feed we don't have and offer to build the persistence/integration.
