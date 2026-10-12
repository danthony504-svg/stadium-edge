# Proven greenfield Coach call graph: `send()` → ticket render

**Branch / entry:** `artifacts/stadium-mobile/app/(tabs)/coach.tsx`  
**Method:** Import + call-site evidence only (no filename inference).  
**Status legend:**

| Status | Meaning |
|--------|---------|
| **ACTIVE** | Called on the greenfield `send()` path under a reachable branch |
| **FALLBACK** | Reachable only when a preferred branch fails / times out / empties |
| **DEAD** | Module may be imported transitively, but this symbol is never called from `send()` |
| **LEGACY-BUT-REACHABLE** | Old helper still live in an imported module; callable if wired, but greenfield seating does not call it |

---

## 1) `send()` → render call graph (ordered)

### A. `send()` entry + session latch

1. `CoachScreen.send` — `coach.tsx:330`
2. Busy-stop flush (optional): `resolveCoachTerminalPicks` → `finishSession` — `coach.tsx:345–364`
3. Route decision (`coach.tsx:386–391`):
   - `wantsLiveCoachAsk(text)` → Live path
   - `isOpenCoachParlayAsk(text) && !images` → Parlay path
   - images → Vision path
   - else → Q&A `streamChat` path
4. `beginCoachSession` — `coach.tsx:441`
5. Absolute budget arm: `armCoachAbsoluteTerminal` → `fireAbsoluteTerminal` → `resolveCoachTerminalPicks` → `finishSession` — `coach.tsx:478–503`, `509/590/726`

### B. Parlay build path (primary ticket path)

6. `buildCoachParlay({...})` — import `coach.tsx:46`, call `coach.tsx:625`
7. `loadScanInputs` — `buildParlay.ts:142` / call `:251`
8. `parseCoachAskMarketConstraint` → `propsOnly` / allowlists — `buildParlay.ts:264–273`
9. Context loads (injuries / MLB / football / matchup) — `buildParlay.ts:337–384`
10. `onReadyToScan` → arms absolute clock — `coach.tsx:652–659` / `buildParlay.ts:404`

#### B1. Props-only early return (ACTIVE when `propsOnly && !hrBoardAsk`)

11. `shouldBuildFootballPropsOnlyTicket` — always `true` when `propsOnly && pool.length` — `coachFootballPropsOnly.ts:70–76`, gated at `buildParlay.ts:429–432`
12. `buildFootballPropsOnlyTicket` — `coachFootballPropsOnlyTicket.ts:593`, call `buildParlay.ts:442` (recovery retries `:502`, `:549`)
13. Inside ticket builder:
    - `gradeFootballPropsOnlyFromHistory` / optional `fetchPropSimulations`
    - `stageFootballPropsOnlyLegs` → `stageFootballPropsOnlyLegsWithCap` — `coachFootballPropsOnly.ts:272` / `:192`
    - **`meetsCoachSimQualityFloor` hard gate** — `coachFootballPropsOnly.ts:215`
    - marks seated picks `propsOnlyTicket: true` — `:255`
14. `selectFinalCoachParlayPicks` (identity) — `boardScanPropDelivery.ts:309–312`, call `buildParlay.ts:463`
15. Optional recovery via `shouldRecoverPropsOnlyWithFootballSkillBoard` — `buildParlay.ts:489–598`
16. Return `{ picks, note }` → `coach.tsx:671–722` → `finishSession`

#### B2. Full board scan (ACTIVE when not props-only early-return; also HR props-only)

17. `tryReachFullBoardScan` — import `buildParlay.ts:24`, call `:704`  
    wrapper `boardMarketScanner.ts:1731` → `buildTopLegsFromFullBoardScan` `:1124`
18. Game-line sim + `attachPickScores` → scored game legs — scanner body ~`1250+`
19. Prop phase: `appendPropScoredLegs` / `attachPickScores` — `boardMarketScanner.ts:453–600` (scores **all** sim-hit props; no `meetsCoachSimQualityFloor` here)
20. Partials / final: `buildScanResult` — `:826`, calls at `:1283` (partial) and `:1645` (final)
21. `buildStagedTicketFromScan` — import `:77`, call `:880` → `ticketStaging.ts:775`
22. Staging internals (ACTIVE):
    - `boardLegPoolRole` — `ticketStaging.ts:113` → `pickIsAiRecommended` / `propSimEdgeStagingQualifies` / `qualifiesAltPick` / `propQualifiesForTicketFill`
    - `buildIndependentCoachTicket` when `varietySeed` set — `ticketStaging.ts:808–813` → `coachTicketCombinations.ts:1005`  
      (greenfield always sets `varietySeed: greenfield-…` — `buildParlay.ts:731`)
    - `qualifyingScoredLegs` filters via `boardLegPoolRole` — `coachTicketCombinations.ts:162–164`
    - shortfall backfill: `tieredBackfillStagedTicket` → `poolRoleAtMinGrade` / `pickQualifiesForBoardDelivery` — `coachTicketCombinations.ts:566–588`, `521–532`
23. Post-stage assembly in `buildScanResult` (`boardMarketScanner.ts:891–1000`):
    - `injectPrioritySportsIntoTicket` (requires `boardLegPoolRole != null` — `coachPrioritySports.ts:182`)
    - **`fillReservedPropSlots`** — `boardScanPropDelivery.ts:572` (**no** `boardLegPoolRole` / **no** `meetsCoachSimQualityFloor`)
    - `topUpTicketFromQualifiedScored` — `ticketStaging.ts:197` (requires `boardLegPoolRole`)
    - `finalizeFootballPropMixPicks` / `finalizeGeneralPropMixPicks`
    - `tagTicketRoles`
24. Scan result → `buildParlay.ts:833+`:
    - `selectFinalCoachParlayPicks`
    - optional `enforceMlLeanOnPicks` (candidates must `boardLegPoolRole != null`)
    - optional `topUpAfterMlLean` → `topUpTicketFromQualifiedScored` (`postLeanFinalFill.ts:105`, `:187`)
25. Return → `coach.tsx:671–722` → `finishSession` (`coach.tsx:278`) → FlatList `PickCard` (`coach.tsx:977`)

### C. Live Coach path

26. `buildLiveCoachRecommendations` — `coach.tsx:592` → `lib/liveCoach/buildLiveCoach.ts`  
    Uses live eligibility / `gradeLiveMarket` — **does not** call `meetsCoachSimQualityFloor` or board staging.

### D. Vision / Q&A paths (can paint cards via `parsePicks`)

27. Vision improve: `streamChat` → `parsePicks` — `coach.tsx:551–577` / `parsePicks` at `PickCard.tsx:1884`  
28. Q&A: `buildChatContext` → `streamChat` → `parsePicks` — `coach.tsx:728–758`  
    `parsePicks` grounds to posted odds/props only — **no** sim quality floor.

### E. Terminal render

29. `finishSession` stores `picks` on assistant message — `coach.tsx:318–324`
30. FlatList maps `item.picks` → `<PickCard … />` — `coach.tsx:971–982`
31. PickCard grade UI calls `pickGradeDisplayLabel` → `pickPassesTicketGate` — `PickCard.tsx:37–38`, `:1115` → `pickRecommendation.ts:370–377`
32. “Add to slip” inside PickCard is behind `SLIP_UI_ENABLED` — `PickCard.tsx:1185–1216`; flag `slipUi.ts:5` = `false`

---

## 2) Function status table (with evidence)

| Symbol | Status | Evidence |
|--------|--------|----------|
| **`send`** | **ACTIVE** | Defined `coach.tsx:330`; wired send button `:1099`, submit `:1096` |
| **`buildCoachParlay`** | **ACTIVE** | Import `coach.tsx:46`; call `:625` when `parlayBuild` |
| **`tryReachFullBoardScan` / `buildTopLegsFromFullBoardScan` / `buildScanResult`** | **ACTIVE** (non-props-only + HR props-only); **FALLBACK** relative to props-only early return | Import `buildParlay.ts:24–26`; call `:704`. Props-only early return skips scanner (`:429–691` returns `scan: null`) |
| **`shouldUseFullBoardScan` / `reachBoardScanEligible` (`kernelOnly`)** | **DEAD** from send | Defined `boardMarketScanner.ts:1675` / `:1705`; greenfield always calls `tryReachFullBoardScan` directly (`buildParlay.ts:704`) — never gates on these. `kernelOnly` only appears in `reachBoardScanEligible` (`:1716–1725`) |
| **`shouldBuildFootballPropsOnlyTicket`** | **ACTIVE** | Call `buildParlay.ts:432`; impl `coachFootballPropsOnly.ts:70–76` |
| **`buildFootballPropsOnlyTicket`** | **ACTIVE** (props-only) | Call `buildParlay.ts:442` (+ recovery `:502`, `:549`); export `coachFootballPropsOnlyTicket.ts:593` |
| **`stageFootballPropsOnlyLegs` / `*WithCap`** | **ACTIVE** (props-only) | Call `coachFootballPropsOnlyTicket.ts:860`; impl `coachFootballPropsOnly.ts:272` / `:192` |
| **`meetsCoachSimQualityFloor`** | **ACTIVE** on props-only seating + `propsOnlyTicketCleared`; **not** called on board-scan seating | Call `coachFootballPropsOnly.ts:215`; def `gameSimQualityGates.ts:51`; also `propsOnlyTicketCleared` `pickRecommendation.ts:425` |
| **`propsOnlyTicketCleared`** | **ACTIVE** (display gate + props-only identity); seating uses floor directly | Def `pickRecommendation.ts:419`; used by `pickPassesTicketGate` `:441`; seats marked `propsOnlyTicket: true` at `coachFootballPropsOnly.ts:255`. **Not** used by `boardLegPoolRole` |
| **`pickPassesTicketGate`** | **ACTIVE** on **render** (grade tile); **not** used for board seating | Def `:437`; `pickGradeDisplayLabel` `:376`; PickCard import/call `PickCard.tsx:37`, `:1115`. Board seating uses `boardLegPoolRole` instead |
| **`propSimEdgeStagingQualifies`** | **ACTIVE** | Def `pickRecommendation.ts:225`; `boardLegPoolRole` `ticketStaging.ts:119`, `:141`; also `pickPassesTicketGate` `:442` |
| **`pickIsAiRecommended`** | **ACTIVE** | Def `:302`; `boardLegPoolRole` `:118`, `:125` |
| **`qualifiesAltPick`** | **ACTIVE** | Def `:333`; `boardLegPoolRole` `:123`, `:126`, `:138` |
| **`pickQualifiesForBoardDelivery` / `boardScanStagedLegQualifies`** | **ACTIVE** via tiered backfill / quality tiers; **DEAD** as post-scan delivery filter | Used by `legQualifiesAtMinGrade` / `poolRoleAtMinGrade` (`coachTicketQualityTiers.ts:95`, `:119`) → `backfillAtQualityTier` (`coachTicketCombinations.ts:532`). Old wrappers `sanitizeCoachTicketPicks` / `coachDeliverBoardScanPicks` / `finalizeCoachTicketPicks` etc. are **DEAD** from send (only tests) |
| **`buildStagedTicketFromScan` / `ticketStaging`** | **ACTIVE** | Call `boardMarketScanner.ts:880`; def `ticketStaging.ts:775`; re-export scanner `:84` |
| **`boardLegPoolRole`** | **ACTIVE** | Def `ticketStaging.ts:113`; used throughout staging / top-up / combinator / priority inject |
| **`fillReservedPropSlots`** | **ACTIVE** | Calls `boardMarketScanner.ts:901`, `:912`, `:954`; **no quality-floor call** |
| **`topUpTicketFromQualifiedScored`** | **ACTIVE** | Call scanner `:939`; post-lean `postLeanFinalFill.ts:187` |
| **`selectFinalCoachParlayPicks`** | **ACTIVE** (pass-through) | Def `boardScanPropDelivery.ts:309–312`; calls `buildParlay.ts:463`, `:837` |
| **`resolveCoachTerminalPicks`** | **ACTIVE** | Import `coach.tsx:71`; calls `:345`, `:489`, `:674` (empty-result FALLBACK), `:775` |
| **`shouldPublishCoachTicketPicks`** | **ACTIVE** but returns false while `"building"` | Def `coachTicketHold.ts:25–27`; call `coach.tsx:645` — mid-build cards stay unpublished |
| **`PickCard`** | **ACTIVE** | Import `coach.tsx:30`; render `:977` |
| **`SLIP_UI_ENABLED` / “Add to slip”** | **DEAD UI** (code reachable, flag off) | Flag `slipUi.ts:5` = `false`; button `PickCard.tsx:1185–1216` |
| **`parsePicks`** | **ACTIVE** on vision-improve + Q&A | Calls `coach.tsx:572`, `:753`; def `PickCard.tsx:1884` |
| **`buildLiveCoachRecommendations`** | **ACTIVE** on live asks | `coach.tsx:592` |
| **Old delivery helpers** (`sanitizeCoachTicketPicks`, `coachFlashTicketPicks`, `prepareBoardScanDelivery`, `finalizeCoachTicketPicks`, …) | **LEGACY-BUT-REACHABLE** (same module as active gates); **DEAD** call sites from send | Live only in `pickRecommendation.ts` + tests — zero calls from `coach.tsx` / `buildParlay.ts` / `boardMarketScanner.ts` / `boardScanPropDelivery.ts` |
| **`boardLegQualification`** | **LEGACY-BUT-REACHABLE / diagnostics ACTIVE** | Imported by `coachBoardScanManifest.ts:10` and type-used by `coachFootballPropFunnel.ts:8` on scanner path; explains gates, does not seat |

---

## 3) Every place that can seat a prop **without** calling `meetsCoachSimQualityFloor`

`meetsCoachSimQualityFloor` is only invoked at:

- `coachFootballPropsOnly.ts:215` (props-only staging)
- `pickRecommendation.ts:425` (`propsOnlyTicketCleared` — display/gate helper, not board seating)

All of the following can put `isProp` legs on the ticket **without** calling that function:

| # | Seating site | Why no `meetsCoachSimQualityFloor` | Evidence |
|---|--------------|--------------------------------------|----------|
| 1 | **`boardLegPoolRole` → staged ticket** (`buildStagedTicketFromScan` / combinator) | Uses `pickIsAiRecommended` / `propSimEdgeStagingQualifies` / `qualifiesAltPick` / `propQualifiesForTicketFill`. Those use **`effectivePropConfidence`** (simHit floor boost) or holistic fill grade `B-`, **not** `meetsCoachSimQualityFloor` (raw `confidencePct`) | `ticketStaging.ts:113–144`; `pickRecommendation.ts:178–179`, `:225–240`, `:302–321`; `propHolisticRecommendation.ts:591–617` |
| 2 | **`fillReservedPropSlots`** | Takes any prop from `stagePool` (all scored legs). **No** `boardLegPoolRole`, **no** floor | `boardScanPropDelivery.ts:572–691`; called `boardMarketScanner.ts:901/912/954` |
| 3 | **`topUpTicketFromQualifiedScored` / `topUpAfterMlLean`** | Requires `boardLegPoolRole != null` only (same as #1) | `ticketStaging.ts:222`; `postLeanFinalFill.ts:105` |
| 4 | **`injectPrioritySportsIntoTicket` / `enforceMultiSportFloorOnTicket`** | `boardLegPoolRole` only | `coachPrioritySports.ts:182`, `:255` |
| 5 | **`tieredBackfillStagedTicket` → `poolRoleAtMinGrade` / `legQualifiesAtMinGrade`** | Can accept props via `pickQualifiesForBoardDelivery` or `confidencePct >= 52 && simAligned` without calling floor helper | `coachTicketQualityTiers.ts:77–110`; `coachTicketCombinations.ts:521–588` |
| 6 | **`parsePicks` (vision improve / Q&A)** | Odds/prop-pool grounding only | `PickCard.tsx:1884+`; `coach.tsx:572`, `:753` |
| 7 | **Live Coach** | Live grade/eligibility path | `coach.tsx:592` → `lib/liveCoach/buildLiveCoach.ts` |
| 8 | **Absolute-budget / stop / error flush** | Re-publishes buffered picks already seated by #1–5; no re-floor | `resolveCoachTerminalPicks` `coachTicketHold.ts:36–62`; calls `coach.tsx:345/489/674/775` |

**Divergence note (proven):** `propSimEdgeStagingQualifies` / `pickIsAiRecommended` use `effectivePropConfidence = max(confidencePct, propSimConfidenceFloor(simHit))` (`pickRecommendation.ts:178–179`). `meetsCoachSimQualityFloor` uses raw `confidencePct` only (`gameSimQualityGates.ts:55–56`). Board-scan seating can therefore Clear props that would fail the named floor helper.

---

## 4) Every place that can render “Add to slip” on Coach messages

| Location | On Coach message bubble? | Gate | Evidence |
|----------|--------------------------|------|----------|
| **`PickCard` button** | **Yes** — Coach FlatList renders `<PickCard>` per pick | `SLIP_UI_ENABLED` must be true | Render path `coach.tsx:971–982` → `PickCard.tsx:1185–1216` (`"Add to slip"` at `:1214`). Flag `lib/slipUi.ts:5` = **`false`** → **never painted** |
| `app/prop/[id].tsx` | No (detail sheet after card tap) | `SLIP_UI_ENABLED` | `:1265–1293` |
| `app/team-pick/[id].tsx` | No (detail sheet after card tap) | `SLIP_UI_ENABLED` | `:727–755`, `:1178–1206` |

**Coach-message conclusion:** The only Add-to-slip control that can appear *inside* Coach assistant messages is `PickCard`’s button. It is compiled into the greenfield path but **disabled** by `SLIP_UI_ENABLED === false`. There is no second slip CTA in `coach.tsx` itself.

---

## 5) OLD / kernel / ota-recovery paths still importable from greenfield `send`

### Proven **not** on the send import closure

- **`ota-recovery` / `otaRecoveryState` / OTA updaters** — not reachable from `coach.tsx` transitive imports (scanned 146 modules from `send` imports). Those live under app diagnostics / updater entrypoints, not Coach send.

### Importable (same modules as ACTIVE scan) but **DEAD call sites** from send

| Path / symbol | Classification | Evidence |
|---------------|----------------|----------|
| `reachBoardScanEligible` + `kernelOnly` | **DEAD** | `boardMarketScanner.ts:1705–1726`; never called from `buildParlay.ts` |
| `shouldUseFullBoardScan` | **DEAD** | `:1675`; greenfield always `tryReachFullBoardScan` |
| `sanitizeCoachTicketPicks` / `coachDeliverBoardScanPicks` / `coachFlashTicketPicks` / `prepareBoardScanDelivery` / `finalizeCoachTicketPicks` / `finalizeBoardBuiltCoachTicket` / `topUpBoardBuiltTicket` / `coachPreserveStagedBoardPicks` / `filterTicketPicks` (as seating filter) | **LEGACY-BUT-REACHABLE** module, **DEAD** from send | Live in `pickRecommendation.ts`; zero calls from `coach.tsx` / `buildParlay.ts` / `boardMarketScanner.ts` / `boardScanPropDelivery.ts` |
| Comment “delivery god-file” | Historical only | `coach.tsx:4` |

### Still on path as **diagnostics / types** (not seating)

- `boardLegQualification.ts` via `coachBoardScanManifest` / `coachFootballPropFunnel` on the scanner path — explains qualification; does not seat legs.

---

## Summary verdict

Greenfield Coach `send()` → ticket is: **session + `buildCoachParlay` → (props-only ticket builder *or* `tryReachFullBoardScan` → `buildStagedTicketFromScan`) → terminal latch → `PickCard`**.

Quality seating for board scan goes through **`boardLegPoolRole` / equivalent inline gates**, not through **`meetsCoachSimQualityFloor`**. The named floor is enforced on the **props-only** staging path. **`fillReservedPropSlots`** can seat props with neither. **Add to slip** exists only inside `PickCard` on Coach messages and is **off** (`SLIP_UI_ENABLED=false`). No ota-recovery Coach path is importable from this `send()`.
