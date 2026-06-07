---
name: Spread "beat the number" copy must be sign-aware
description: Honesty trap when presenting a team's recent scoring margins against a picked spread line.
---
When a team-pick detail surface shows "how often this team beat the number" from real scoring margins, the threshold math and the COPY must both respect the line's sign.

The rule:
- Favourite (line < 0, e.g. -4.5): beats = margin > |line|. Copy: "won by 4.5+".
- Underdog (line > 0, e.g. +3.5): beats = margin > -line (i.e. lost by fewer than the number, OR won). Copy: "covered +3.5" / "lost by fewer than 3.5 (or won)". NEVER "won by X+".
- Moneyline / pick'em (no line): beats = win. Copy: "won outright".

**Why:** HONESTY-SENSITIVE user. The cover math (`coverThreshold = -line`) was correct, but the UI text was hardcoded "won by X+" for any line!=null, which is FALSE for underdogs and reads like a fabricated favourite-style claim. Architect flagged it as an honesty leak.

**How to apply:** Any "beats the spread / covers" framing derived from real margins (mobile `app/team-pick/[id].tsx`, web equivalents). Also always caption such charts as "vs varied opponents — NOT an ATS record vs this game's closing line", because real game results are not graded against the actual posted line.
