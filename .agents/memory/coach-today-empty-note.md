---
name: Coach today-only empty-build note must split causes
description: Why a "today" build that returns zero legs must never say "nothing upcoming" and must distinguish thin-slate vs all-filtered.
---

# Today-only empty-build note (mobile Coach)

When a "today/tonight" Coach build ends with zero legs, the appended note must
be honest about WHY. The old single note claimed "Nothing on today's board is
still upcoming…" for every empty case.

**Why this was wrong (two independent reasons):**
1. `todayOnly` is only ever true when `resolveTodayOnly` found ≥1 game that is
   still upcoming today. So "nothing is upcoming" is *always at least partly
   false* whenever the note can fire — and it directly contradicts the model's
   own prose ("Only one today soccer match is posted…").
2. It conflated two distinct empty-result causes that need different guidance:
   - **before > 0** (resolved-pick count *before* the `startsTodayUpcoming`
     filter): legs DID ground in real odds but every one was on a game that
     already kicked off or isn't on today's local calendar day → filtered out.
     Offer: build next-48h, or check back near kickoff.
   - **before === 0**: the model emitted PICK lines but none grounded in real
     odds — the slate is too thin to build the requested ticket without forcing
     it. Classic sport-locked "today" soccer ask: one World Cup match can't
     supply a SAFE 7-leg. Offer: full-week slate, or a shorter ticket.

**How to apply:** note selection lives in a pure helper `todayBuildNote({before,
surviving, emittedPickLines})` in `lib/slate.ts` (re-exported via `lib/api.ts`),
unit-tested in `lib/todayBuildNote.test.ts`. Keep the wording general (shared by
ALL sports/"today" asks, not just soccer) and never reintroduce the "nothing
upcoming" phrasing. This is a UX-truthfulness fix only — it adds/removes no
picks, so the never-fabricate invariant is untouched. The `dropped>0`-with-
survivors branch (the transparency "Showing N real legs…" count) is unchanged.

**Context that made the empty case common:** Coach context is the full ~500KB
48h multi-sport pool (realOdds≈120, realGames≈10); the model itself narrows to
soccer+today and the CLIENT post-parse filters by `startsTodayUpcoming`. At
`reasoning_effort:"low"` over that context a single chat completion measured
~42s end-to-end — the SSE heartbeat holds it open, but it is the latency driver
(context size, not reasoning level).
