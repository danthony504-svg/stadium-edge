---
name: Coach AI loading progress screen
description: Mobile Coach build/analyze loading card (AnalysisProgress) — how it grounds and gates
---

The mobile AI Coach build/analyze wait shows a rich `AnalysisProgress` card
(components/AnalysisProgress.tsx), NOT a bare spinner: 10 named stages,
0→100% blue→cyan gradient bar, pulsing glow dot, 5-item live checklist.

**Grounding (so it's honest, not a fake timer):** build mode's auto-timer
holds at stage index 8 (~93%) and only advances to the final "Finalizing…"
stage + 100% when real PICK lines stream (`legCount` > 0, fed from
`buildingLegCount`). Analyze mode has no leg stream so it self-completes.
Intermediate stages are cadence-based — acceptable because the *completion*
signal is real. Cyan (#22d3ee) is LOCAL to this component, not a theme token.

**Gating in coach.tsx:** render `<AnalysisProgress mode="build" .../>` while
`isBuildingParlay`, else `mode="analyze"` while
`analyzeWaiting = isWaiting && !!m.analyzeSlip?.length`, else `mode="ask"`
while `askWaiting = isWaiting && !isBuildingParlay && !analyzeWaiting` (a
PLAIN question — the box now shows for ANY wait, not just build/analyze).
All three waiting states are excluded from `showBubble` so no empty spinner
bubble flashes alongside the card. The old rotating `ThinkingStages` pill that
used to cover plain-question waits is GONE (fully replaced by ask mode).

**"ask" mode honesty:** has its OWN stage/checklist set (ASK_STAGES/
ASK_TARGETS/ASK_CHECKLIST, 9 stages) because a plain question has no ticket —
copy must NOT claim ticket/correlation/weak-leg work; only generic real work
(pull live odds+props+matchup context, reason, write answer). Walks to its
final stage on its own like analyze (no legCount). build+analyze still share
the ticket-oriented STAGES/TARGETS/CHECKLIST.

**Why:** users perceived the old "Building…" pill as a dead spinner on long
(19–65s TTFT) model waits. The card must feel like real analysis but must
NOT fabricate betting data — labels stay generic ("Line value calculated"),
never specific picks/edges.

**Replaced machinery:** the old `BUILD_STAGES` const + `buildStage` state +
`stageTimerRef` setInterval were removed; AnalysisProgress is fully
self-driving. Client-only change → needs a new native build / OTA to reach
the installed app.
