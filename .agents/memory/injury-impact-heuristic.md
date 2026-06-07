---
name: Injury report impact + edge (no WAR)
description: How the mobile team-pick INJURY REPORT derives per-injury impact and the team injury edge without any WAR/depth-chart feed.
---

The mobile team-pick INJURY REPORT card (artifacts/stadium-mobile/app/team-pick/[id].tsx,
helpers in lib/injuries.ts) shows per-injury Impact (High/Med/Low/Minimal), an
"INJURY EDGE" summary, position-group counts, friendly status labels, and an
expand/collapse "View all N injuries".

**Rule:** there is NO WAR, depth-chart, or starter feed. "Impact" is a
deterministic guide = injury severity (from ESPN status string) x position
weight (premium positions per sport: MLB SP, NFL QB, goalies). The team EDGE
goes to the LESS-injured team by total impact score; require a gap (~one
high-impact, score diff >=3) before claiming an edge, else "even".

**Why:** this user is honesty-sensitive — never fabricate a metric. The user
literally asked for WAR numbers; we must NOT invent them. A heuristic derived
only from REAL ESPN inputs is allowed ("deterministically derived"), but it must
be labeled a guide, not a player rating (footnote in the card).

**How to apply:** any new injury-impact surface must reuse friendlyInjury /
injuryImpact / summarizeTeamInjuries / injuryEdge. Don't introduce WAR-like
precision. The edge CAPTION must not cite high-impact counts when they're equal
(edge is total-score-driven) — fall back to total-impact wording. Card is
mobile-only; web team-pick has no injury rail.
