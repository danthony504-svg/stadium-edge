---
name: Fix button adds an AI leg
description: What the slip "Fix" button (optimizeSlip) does and the constraints behind it
---

The slip "Fix" button (`optimizeSlip` in ParlayBuilder.tsx) has two jobs:
1. Silently adjust every existing leg toward a safer line (buy points on spreads/totals, nudge props to season avg) — NO analysis panel/text (`setSlipAnalysis(null)`). User explicitly rejected any wall-of-text note.
2. Append ONE brand-new AI-recommended REAL leg via `bestAiPickForFix(excludeGames)` → `autoFillSlip([pick])`.

**Why:** User chose (via user_query) "add a brand-new AI leg and roll its points into the aggregated total" over a compact badge or single-strongest-leg highlight.

**How to apply / constraints:**
- `bestAiPickForFix` sources ONLY from `realOddsBySport` (never invent a line — same rule as everywhere in this app), builds candidates with `buildPicksFromOdds(g)`, sorts by `calculateConfidence` desc, returns top or null.
- It EXCLUDES games already on the slip, compared by an orientation-independent team-pair key (`gamePairKey` parses `@`/`vs`/`v`, lowercases, sorts the pair) — raw-string equality is NOT enough (architect caught this: "A vs B" vs "B @ A" would slip a correlated leg through). This is the anti-correlation guard for Fix.
- Skips odds `<= -1000` or `>= 1000` (no-value juice / extreme longshots) and any pick already on the slip (`legKey`).
- The aggregated total (combined odds + confidence) derives from `parlayLegs` via `calculateParlay`, so the appended leg rolls in automatically — no separate total-update code.
- State timing is fine: `setParlayLegs(adjusted)` then `autoFillSlip`'s functional `setParlayLegs(prev => [...prev, ...legs])` yields `adjusted + aiPick` in order; the new leg is from an excluded game so `autoFillSlip`'s stale-closure dedup can't drop/dupe it.
