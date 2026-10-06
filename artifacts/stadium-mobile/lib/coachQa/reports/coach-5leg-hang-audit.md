# Coach 5-leg hang audit (post-#612) — report only

## Verdict

**Last completed production UI stage:** game-line scoring partial with `awaitingPropSlots=true` — status `Scoring game lines… props/alts next (~3180 posted)`.

**First stage that does not complete on the phone:** exit from the overlapping game-sim loop → prop/ALT merge → ticket finalize → `finishSession` / busy clear. The UI never leaves Building/Scanning.

**Root cause (audit):** After RC1, bare `5 leg` correctly enters full-board overlap. While game-line sims run, every `onPartial` is emitted with **game lines only** and `awaitingPropSlots`, which **repaints** the exact phone status and hides the fact that props already scored in a parallel wave. That awaiting window lasts ~18s on Node (~11.6s→29.4s) and is the entire visible hang surface. Production-equivalent Node A/B both **do** terminate (~28–30s, 5 legs). The phone indefinite hang is therefore **not** stale propsOnly and **not** soccer prior inheritance; it is a **terminal-latch / mobile completion gap** on top of a long game-sim phase that freezes status on that message — with a confirmed missing `res.json()` body timeout on `fetchGameOutcomeSimulation` / `fetchPropSimulationsBatch` as the strongest unresolved-await risk if cellular stalls past the absolute wall.

## A vs B (production API)

| metric | A fresh 5 leg | B1 4 leg soccer | B2 5 leg after soccer |
|---|---:|---:|---:|
| posted candidates | 3198 | 0 | 3197 |
| game-line candidates scored | 1988 | 0 | 1980 |
| prop/ALT deep-sim scored | 9 | 0 | 9 |
| prop/ALT final legs | 2 | 0 | 2 |
| game-line final legs | 3 | 0 | 3 |
| final legs / staged | 5 | 0 | 5 |
| total runtime ms | 28808 | 1618 | 27789 |
| terminal reached | True | True | True |
| last progress | status: Scoring ticket… 5 legs (2 props/alts) | status: No matching props posted for a 4-leg ticket… | status: Scoring ticket… 5 legs (2 props/alts) |

Probe (B2): awaiting window **17798ms** on `Scoring game lines… props/alts next (3246 posted)`; no sim call >12s; bodies ~45–150KB; terminal yes at 29501ms.

## Stage timings (A_fresh)

| tMs | stage |
|---:|---|
| 11 | start ask="5 leg" priors=[] legs=5 budgetMs=75000 propsOnly=false gameLinesOnly=false requirePropMix=false api=https://stadium-edge.onrender.com/api |
| 52 | status: Loading tonight's board… |
| 1624 | status: Loading player props and alt lines across the board… |
| 4072 | status: Loading matchups, injuries, and opponent context… |
| 8079 | onReadyToScan propPoolSize=3198 maxToSim≈500 propDeadlineMs=40000 |
| 8079 | status: Scanning 3198 posted props/alts plus game lines for a 5-leg ticket… |
| 9635 | status: Scoring ticket… 2 legs (2 props/alts) |
| 28716 | status: Scoring game lines… props/alts next (3198 posted) |
| 28806 | status: Scoring ticket… 5 legs (2 props/alts) |
| 28808 | buildCoachParlay returned picks=5 timedOut=false propPoolSize=3198 noteLen=0 |

## Stage timings (B2 after soccer)
| tMs | stage |
|---:|---|
| 0 | start ask="5 leg" priors=["4 leg soccer"] legs=5 budgetMs=75000 propsOnly=false gameLinesOnly=false requirePropMix=false api=https://stadium-edge.onrender.com/api |
| 3 | status: Loading tonight's board… |
| 1053 | status: Loading player props and alt lines across the board… |
| 2843 | status: Loading matchups, injuries, and opponent context… |
| 7133 | onReadyToScan propPoolSize=3197 maxToSim≈500 propDeadlineMs=40000 |
| 7133 | status: Scanning 3197 posted props/alts plus game lines for a 5-leg ticket… |
| 9621 | status: Scoring game lines… props/alts next (3197 posted) |
| 9671 | status: Scoring ticket… 5 legs (2 props/alts) |
| 27686 | status: Scoring game lines… props/alts next (3197 posted) |
| 27787 | status: Scoring ticket… 5 legs (2 props/alts) |
| 27789 | buildCoachParlay returned picks=5 timedOut=false propPoolSize=3197 noteLen=0 |

## Hypothesis checklist

| hypothesis | Node evidence |
|---|---|
| unresolved Promise / missing await completion | Not reproduced; buildCoachParlay returns. Body `res.json()` after timed fetch still has **no timeout** in `fetchGameOutcomeSimulation` / `fetchPropSimulationsBatch` (mobile risk). |
| request with no timeout | Fetch headers timed (24s game / 12–36s prop); **JSON body untimed**. |
| provider call hanging | No hang in Node; max game body ~150KB, totalMs <2s. |
| simulation batch hanging | No batch >12s; game phase progresses. |
| 429 retry/backoff loop | Game-outcome POST does not 429-retry (returns null on !ok). |
| 3180-candidate board excessive work | Real: ~3200 posted, maxToSim≈500, ~9 props scored, ~1980 game legs scored; Node finishes ~30s. Board size explains long awaiting UI, not Node non-termination. |
| stale AbortController / soccer cancel | B2 after soccer matches A; prior abort not causal. |
| finishSession / isScanning stuck | **Primary phone-side suspect** if wall >75s with Building still true — absolute terminal or busy clear failed on device while scan status frozen on awaitingPropSlots. |
