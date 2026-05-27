---
name: Stadium Edge no-fake-data rule
description: Hard rule for the Stadium Edge demo — every leg, score, total, and live-game field must trace to real data or render blank.
---

Stadium Edge is a sports-betting demo wired to real live feeds (ESPN scoreboard + the-odds-api). The product rule is absolute: **anything the UI shows that looks like a fact must come from a real upstream value, or it must be dropped / rendered as "—".** No fabricated 0-0 scores, no invented win probabilities, no "Live" placeholder when ESPN didn't ship a period label, no synthetic totals.

**Why:** The whole point of the demo is to show that picks/tickets/live cards are grounded in live data. A single fake number (e.g. defaulting `awayScore ?? 0` mid-game) destroys that trust and was specifically called out by the user.

**How to apply:**
- When pushing real ESPN games into UI lists, keep nullable fields nullable (`awayScore ?? null`, not `?? 0`). Don't substitute strings like "Live" for a missing periodLabel — fall back only through other real fields (`status`) and then to "—".
- Gate any branch that switches between real and simulated data on an explicit `g.real === true` flag, not on `realArray.length > 0`. Otherwise a sim game can land in the real array and silently get pacing/odds enrichment applied to it.
- Derived values (pacing, current total, projected total) must require ALL their inputs to be real and finite (`Number.isFinite(total) && Number.isFinite(score) && period > 0`) before computing. Otherwise blank.
- Chat/ticket pick filtering must DROP unverifiable legs (no pass-through). When a pick is dropped, surface an `unusableReason` so the AI acknowledges the gap instead of pretending it never existed.
- Don't fabricate a coarse status either: if ESPN's `status.type.description` is missing, derive from `status.type.state` (`in`→"In Progress", `post`→"Final", `pre`→"Scheduled", else "Unknown") rather than defaulting to "Scheduled".
