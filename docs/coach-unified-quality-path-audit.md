# Coach unified quality path — audit (pre-implementation)

**Date:** 2026-10-12  
**Branch base:** `origin/main` @ `0cb3be3c` (includes #709 + #707)  
**Live production tip (at audit):** `01a13019-8a5f-7f4d-bacb-31b1105de281` @ commit `0cb3be3c` (published 12:32 UTC — **includes #709**)  
**Prior tip (pre-#709):** `01a12e0b…` @ `a20c3939`

Proven call-graph detail: `artifacts/stadium-mobile/docs/coach-send-callgraph-proven.md`.

---

## 1) Complete reachable Coach call graph

```
send() [coach.tsx]
 ├─ stop/budget/error → resolveCoachTerminalPicks → finishSession → PickCard
 ├─ Live ask → buildLiveCoachRecommendations → finishSession
 ├─ Vision → streamChat → parsePicks → finishSession
 ├─ Q&A → buildChatContext → streamChat → parsePicks → finishSession
 └─ Parlay (N-leg) → buildCoachParlay
      ├─ propsOnly && !hrBoardAsk
      │    → buildFootballPropsOnlyTicket
      │         → gradeFootballPropsOnlyFromHistory / optional fetchPropSimulations
      │         → stageFootballPropsOnlyLegs → meetsCoachSimQualityFloor (#709)
      │         → selectFinalCoachParlayPicks (identity)
      │         → finishSession → PickCard
      └─ else (mix / HR props-only / game lines)
           → tryReachFullBoardScan → buildTopLegsFromFullBoardScan
                → score game + prop legs
                → buildStagedTicketFromScan
                     → boardLegPoolRole (pickIsAiRecommended | propSimEdgeStagingQualifies | qualifiesAltPick | propQualifiesForTicketFill)
                     → combinator / single-event / HR top-N / tiered backfill
                → fillReservedPropSlots ⚠ NO floor
                → topUpTicketFromQualifiedScored / priority inject / ML lean
                → selectFinalCoachParlayPicks (identity)
                → finishSession → PickCard
```

### Status table (import/call proven)

| Symbol | Status |
|--------|--------|
| `buildCoachParlay` | **ACTIVE** |
| `buildFootballPropsOnlyTicket` / `stageFootballPropsOnlyLegs` | **ACTIVE** (props-only) |
| `meetsCoachSimQualityFloor` | **ACTIVE** props-only seating + `propsOnlyTicketCleared`; **not** board seating |
| `propsOnlyTicketCleared` | **ACTIVE** (display / `pickPassesTicketGate`) |
| `pickPassesTicketGate` | **ACTIVE** render only |
| `propSimEdgeStagingQualifies` / `pickIsAiRecommended` / `qualifiesAltPick` | **ACTIVE** board seating via `boardLegPoolRole` |
| `buildStagedTicketFromScan` / `boardLegPoolRole` | **ACTIVE** |
| `fillReservedPropSlots` | **ACTIVE**, no shared floor |
| `selectFinalCoachParlayPicks` | **ACTIVE** pass-through |
| `resolveCoachTerminalPicks` | **ACTIVE** |
| `PickCard` + `SLIP_UI_ENABLED` | **ACTIVE** render; slip CTA **DEAD UI** (`false`) |
| `shouldUseFullBoardScan` / `reachBoardScanEligible` (`kernelOnly`) | **DEAD** from send |
| Old delivery wrappers (`sanitizeCoachTicketPicks`, `finalizeCoachTicketPicks`, …) | **LEGACY-BUT-REACHABLE** module / **DEAD** from send |
| ota-recovery Coach | **Not importable** from send |

---

## 2) Exact path for F-grade MLB HR (Kwan O1.5 +80000 / DeLuca O1.5 +25000)

### Fingerprint

- Caption: **"Cleared props-only history vs odds (positive EV)"** → only `propsOnlyTicketCleared` returns this string.
- Letter grade F/D shown via `pickGradeDisplayLabel` when `pickPassesTicketGate` is true.
- `+ Add to slip` → `PickCard` behind `SLIP_UI_ENABLED` (false on tip+main).

### Active path (pre-#709 tip `a20c3939` — historically proven)

```
ask "8 leg … player props" / "8 leg MLB"
  → propsOnly: true, ticketStyle: balanced (unless longshot words)
  → buildCoachParlay → shouldBuildFootballPropsOnlyTicket → true
  → buildFootballPropsOnlyTicket
       candidates: pool → rare HR O1.5 (+25k/+80k) via Poisson P(X≥2)
       scoredLegFromHit: EV clear vs tiny implied; (pre-#709) conf lift to ≥52
       stageFootballPropsOnlyLegs: odds-clear only (pre-#709) → seats F/D
       propsOnlyTicket: true
  → PickCard: propsOnlyTicketCleared true without floor → caption + letter grade
```

### Can #709 main / tip `01a13019` still produce this exact fingerprint?

**No for the props-only caption + F letter together:**

- Staging: `meetsCoachSimQualityFloor` (raw grade + raw conf) — F fails.
- `propsOnlyTicketCleared`: same floor — F fails → caption cannot fire.
- `SLIP_UI_ENABLED=false` → Add-to-slip not painted.

**If the device still shows that fingerprint after the 12:32 UTC tip publish**, the phone is **not executing tip `01a13019` / `0cb3be3c`** (stale OTA/embedded). Attestation UI (#707) is on that tip for proof.

### Structural gaps that remain on main even with #709 (different symptoms possible)

1. **`effectivePropConfidence`** lifts raw conf via simHit floor (~68% at 5% hit) in `propSimEdgeStagingQualifies` / `pickIsAiRecommended` — board path can clear conf bar without raw ≥52 (**Invariant B risk**).
2. **`fillReservedPropSlots`** seats props with **no** `boardLegPoolRole` / floor.
3. **Multiple authorities** (floor helper vs staging qualifies vs holistic fill B- vs props-only).
4. **`filterTicketPicksPreservingTicket`** can resurrect simAligned+edge legs after strict filter zeros.
5. N-leg tickets share the same `PickCard` as recommendations (slip gated only by global flag).

---

## 3) Duplicate / conflicting qualification authorities

| Authority | Threshold | Used by |
|-----------|-----------|---------|
| `meetsCoachSimQualityFloor` | grade ≥ C+, **raw** conf ≥ 52 | props-only staging, `propsOnlyTicketCleared` |
| `propSimEdgeStagingQualifies` | C+/edge/EV + **lifted** conf | `boardLegPoolRole`, `pickPassesTicketGate` |
| `pickIsAiRecommended` (prop holistic) | B+/recommends + lifted conf | `boardLegPoolRole` |
| `propQualifiesForTicketFill` | B-/conf 52/sim+value factors | `boardLegPoolRole` |
| `propsOnlyLegClearsOdds` | sim vs implied (+slack) | props-only candidacy (pre-floor) |
| `legQualifiesAtMinGrade` / ticket style tiers | style floors | tiered backfill only |

Conflict: board path never calls `meetsCoachSimQualityFloor`; uses lifted confidence.

---

## 4) Duplicate render / fallback paths

| Path | Role |
|------|------|
| Props-only ticket builder | Early return; marks `propsOnlyTicket` |
| Full board scan + staging | Mix / HR / non-props-only |
| `fillReservedPropSlots` / top-up / priority inject / tiered backfill | Can add legs after staging |
| `resolveCoachTerminalPicks` | Stop/budget/empty flush of buffer |
| Vision/Q&A `parsePicks` | Non-N-leg cards |
| Live Coach | Separate eligibility |
| Single `PickCard` for all | Slip CTA global flag only |

---

## 5) Smallest consolidation design

1. **One pure module** `lib/coach/qualifyCoachCandidate.ts` exporting:
   - `COACH_PIPELINE_VERSION`
   - `qualifyCoachCandidate(pick, score, ctx) → { status, reason, roleHint }`
   - Owns: sim validity, **raw** grade/conf floor (`meetsCoachSimQualityFloor`), edge>0, EV>0, market sim support. Style may add stricter rules; never weaker for `normal` / `props_only`.
2. **`boardLegPoolRole`**: reject if shared qualify fails; then label main/alt only.
3. **`propSimEdgeStagingQualifies` / ticket gates**: conf check uses **raw** `confidencePct` (delete lift from gate path; keep lift out of qualification).
4. **`fillReservedPropSlots` / top-ups**: only candidates with `qualifyCoachCandidate` = qualified (or pre-tagged `qualificationStatus`).
5. **`filterTicketPicksPreservingTicket`**: never resurrect `qualificationStatus === "rejected"`.
6. **N-leg messages**: `responseKind: "nleg_ticket"` → PickCard `allowSlipActions={false}` (structural, not only `SLIP_UI_ENABLED`).
7. **Diagnostics**: `COACH_PIPELINE_VERSION` + existing Updates.* on ota-debug (no network).

No new I/O, no extra MC, no second scan.

---

## 6) Files that can eventually be retired

| File / symbol | After consolidation |
|---------------|---------------------|
| Parallel threshold copies in `propSimEdgeStagingQualifies` / holistic fill / props-only | Thin wrappers over shared qualify |
| Dead `shouldUseFullBoardScan` / `reachBoardScanEligible` | Delete when safe |
| Dead delivery wrappers in `pickRecommendation.ts` | Delete when tests migrated |
| God-file Coach (ota-recovery branch only) | Already not on main send path |

---

## 7) Expected latency effect

| Phase | Effect |
|-------|--------|
| Qualification CPU | Negligible (pure grade/conf/EV checks; may replace duplicate checks) |
| boardScan / propSim / gameSim | **Unchanged** (0 new calls / MC) |
| Staging | Same pool; fewer illegal seats → possibly fewer top-up iterations |
| Wall | Target: **no material regression**; likely flat to slightly faster |

Benchmark hooks: reuse existing coach timing / add optional `performance.now` around qualify only in tests.

---

## Implementation order (this PR)

1. Add `qualifyCoachCandidate` + pipeline version  
2. Wire seating paths + raw-confidence gates  
3. N-leg `responseKind` / slip disconnect  
4. ota-debug pipeline marker  
5. Invariant tests A–G across sports  
6. No OTA / deploy / native build until tests green

---

## Implementation landed (unified-quality-v1)

| Gap | Fix |
|-----|-----|
| Lifted `effectivePropConfidence` in staging/gates | Gates call `coachCandidateIsQualified` (raw conf only) |
| `fillReservedPropSlots` ungated | Requires shared qualify before top-up |
| Multiple floor defs | Thresholds owned by `qualifyCoachCandidate` / `meetsCoachSimQualityFloor` |
| Preserve-ticket resurrection | Rejects `qualificationStatus === "rejected"`; re-checks shared qualify |
| N-leg Add-to-slip | `responseKind: "nleg_ticket"` → `allowSlipActions={false}` (structural) |
| Device pipeline proof | `COACH_PIPELINE_VERSION` on ota-debug snapshot |

**Not done (out of scope / follow-up):** delete dead `shouldUseFullBoardScan` / unused delivery wrappers; OTA publish.

### Bypass closure (post adversarial review)

| Leak | Fix |
|------|-----|
| Tiered backfill on raw `scored` via `legQualifiesAtMinGrade` | Assembly/backfill receive **qualifying-only** pool; `legQualifiesAtMinGrade` requires shared qualify / refuses `rejected` |
| Props-only hardcoded `qualificationStatus: "qualified"` | `withCoachQualification(..., props_only)` — forged qualified stamps stripped |
| Longshot style not wired | `resolveCoachRequestStyle` + `coachRequestStyle` on picks; `boardLegPoolRole` passes longshot |
| Nested re-qualify CPU | Qualify once → attach immutable status → downstream reads (~0.2µs vs ~4µs evaluate) |
