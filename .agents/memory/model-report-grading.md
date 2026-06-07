---
name: Model Report — real bet grading + strengths
description: How finished bets are graded, archived, and fed back to the Coach; the honesty fail-closed rules that govern it.
---

# Model Report: real results tracker + Coach lean-in

Mobile feature that grades the user's finished saved slips against REAL data and
self-assesses which bet categories the model actually hits. Never fabricates W/L
or a performance %.

## Pieces (by responsibility, not line)
- Server grader: `POST /api/sports/grade` (api-server `routes/grade.ts`). Input
  legs `{game,market,pick,sport,odds,startsAt}` → per-leg `{result:win|loss|push|ungraded, family, side, detail}`.
  Game ML/spread/total from ESPN finals; player props from real game log vs line
  (reuses statmuse/period-log + market maps). Fail-closed `ungraded` on any doubt.
- Sync: `results` is in `sync.ts` ALLOWED_NAMESPACES; mobile persists results in the
  bet-slip STORAGE_KEY JSON and pushes/pulls the `results` ns (pull-merge in the
  existing effect, separate debounced push).
- Mobile store: `BetSlipContext.tsx` holds `results: BetResult[]` (cap MAX_RESULTS=300,
  id-merge dedupe), `settleSlips` action.
- Grade-then-archive: `slip.tsx` effect grades a saved slip once EVERY leg's game is
  confirmed over, archives the real outcomes, then removes it from saved.
- Report screen: `report.tsx` + shared analytics in `lib/modelReport.ts`.
- Coach lean-in: `lib/modelReport.ts#computeModelStrengths` → `ChatContext.modelStrengths`
  (api.ts) → injected in coach.tsx at BOTH streamChat sites → soft prompt clause in chat.ts.

## Honesty rules that MUST hold (these were the review failures)
- **Parlay slipResult is FAIL-CLOSED on the win side.** A confirmed losing leg → the
  parlay is `loss` (honest even if other legs never settled). But if NO loss and ANY leg
  is still `ungraded` (the force-archive-after-40h case), the parlay outcome is
  `ungraded`, NOT win/push — an unconfirmed leg could have lost. Per-leg results stay
  individually honest regardless, so leg-level breakdowns are unaffected. Do NOT derive
  the parlay result from "graded legs only" — that fabricates wins.
- **Soccer moneyline is 3-way: a draw LOSES a team ML** (not push). Draw/DNB picks name
  no team and already fall out as `ungraded`. Other sports keep push-on-tie as a safe guard.
- **Strengths are advisory only.** `computeModelStrengths` gates on MIN_INSIGHT_SAMPLE(8)
  and only emits strong(≥55%)/cold(≤42%) categories; coach injects only when non-empty;
  the chat.ts clause forbids it from overriding real per-leg analytics or being cited as a
  matchup edge (and per the internal-names rule, never name the field to the user).

## Concurrency gotcha (grade-then-archive)
The `gradingRef` in-flight guard (Set of slip ids) MUST be released for every slip
claimed in a run via a `finally`, not ad-hoc deletes. The `if (cancelled) return;` path
(deps changed mid-request) and discarded-results runs would otherwise strand a slip in the
guard set and never re-grade it for the session. Committed slips are removed from
savedSlips by settleSlips so clearing their guard is safe.
