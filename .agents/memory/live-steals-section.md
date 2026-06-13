---
name: +500 Steals section (mobile)
description: Mobile-only longshot value-bet finder + auto-graded W/L ledger of the app's OWN steal picks
---

Mobile-only "+500 Steals" surface: longshot bets (American +500..+30000) flagged
positive-EV, PLUS an auto-graded W/L record of the app's OWN steal picks (NOT the
user's bets).

**Honesty constraints (the durable rules):**
- A steal is surfaced ONLY when the feed already carries a REAL de-vig edge — game
  lines via odds.ts per-outcome noVigFair/edge; props via props.ts ev/edge. props.ts
  only computes EV on MAIN lines and only for prices ≤ +600, so props cover just the
  +500..+600 slice. Never fabricate an edge to fill the band.
- Main game lines rarely exceed +500, so an EMPTY pool is the honest normal state, not
  a bug. Don't "fix" emptiness by loosening guards.
- The W/L ledger settles with the app's shared real-result grader (gradeLegs); only
  terminal win/loss/push are recorded, unresolved rows stay pending then age to
  "ungraded" — never invent a result.

**Ledger keying — the bug that bit us:** the steal id MUST include the eventId, NOT the
"Away @ Home" string. **Why:** the same pick in a recurring matchup (series games on
different dates, MLB doubleheaders) collides on a name-only key → onConflictDoNothing
silently drops the later real attempt → W/L UNDERCOUNT. eventId is stable across refreshes
of one game, so dedupe still works.

**Testability constraint:** pure steal-finding/pricing logic must stay import-clean (no
@workspace/db / network / route imports) or node --test throws ERR_UNSUPPORTED_DIR_IMPORT
on lib/db/src/schema — same class as the mobile expo-fetch case. Keep the pure layer
separate from the impure (fetch/persist/grade/cron) layer.

**Operational gotcha:** api-server is autoscale + one-shot build/start (no setInterval, no
hot reload) → the grading cron only fires via the Scheduled Deployment, and you MUST
restart the API workflow after server edits or it serves stale compiled code.
