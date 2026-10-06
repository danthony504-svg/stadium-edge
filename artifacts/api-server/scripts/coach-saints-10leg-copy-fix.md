# 10-leg Saints — inconsistent explanation counts

## Phone symptom
- Badge: 10-Leg parlay (requested 10)
- Copy: “20 main lines + 7 alt lines cleared”
- Copy: “Filled with 3 main picks and 1 alt pick”
- Copy: “These 7 are…”
- Three disagreeing counts in one note.

## Funnel (live re-run after fix)

```
requested     → 10
available     → oddsGames=1, gameEntries=1, propPool=916  (ATL @ NO only)
simulated     → gameSims=1, gameLegsScored=817, propSimEval=21, propLegsScored=12
qualified     → scoredBeforeStage=28
staged → fill/dedupe/top-up/prop-mix → final=7
```

**Actual final ticket length: 7** (4 main + 3 alt), all from `Atlanta Falcons @ New Orleans Saints`.

A 7th–28th qualified candidate existed (`scoredBeforeStage=28`); staging / per-game / correlation / diversity caps limited the delivered ticket. **No thresholds lowered, no filler added.**

## Root cause
`buildScanResult` built the chat note from **`staged.breakdown`** (intermediate `buildStagedTicketFromScan` snapshot) while `picks` continued through prop-slot fill, multi-sport floor, same-team collapse, ladder dedupe, top-up, and football prop-mix finalize.

So the note mixed:
1. **Pool** `mainQualified` / `altQualified` (e.g. 20 + 7)
2. **Pre-mutation staged** `mainOnTicket` / `altOnTicket` (e.g. 3 + 1)
3. **Final** `picks.length` (7)

`buildFinalCoachParlayNote` prefers `scanNote` when prop-like legs exist, so the stale essay replaced the honest shortfall lead.

## Minimal fix
1. `tagTicketRoles(picks)` **after** all ticket mutations; recompute `mainOnTicket` / `altOnTicket` from the delivered ticket.
2. `fullBoardScanShortfallNote(..., { requested })` leads with final length:
   - `You asked for 10 legs. 7 qualified picks were available, so no filler was added.`
3. Drop intermediate pool “N main lines and M alt lines cleared” from shortfall copy.
4. Cite ticket composition only when `mainOn + altOn === pickCount`.

Same class of cleanup in `buildFullBoardShortfallNote` (parlayReachCore).

## Saints team scope
**Unchanged.** Spec/tests: “6/10 leg Saints” = entire Saints **matchup** (opponent markets allowed). Live ticket includes Falcons-side Q1 spread/ML and Falcons team totals — correct.

## Files
| File | Class |
|------|-------|
| `lib/fullBoardMarketCopy.ts` | mobile |
| `lib/boardMarketScanner.ts` | mobile |
| `lib/parlayReachCore.ts` | mobile |
| `lib/fullBoardMarketCopy.test.ts` | tests-only |
| `lib/parlayReach.test.ts` | tests-only |
| audit script/report | tests-only |

## Deploy
**OTA** (client Coach note path). No Render.

## Perf
Phase 2.4 Option C **untouched**.
