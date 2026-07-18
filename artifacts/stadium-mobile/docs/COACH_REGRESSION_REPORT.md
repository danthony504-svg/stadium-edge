# Coach regression baseline report

## 1. Identified last working baseline

**Baseline commit: `b9f60bc32`** (`Home: premium layout — parlay card, 4 quick actions, Today's Performance`)

Rationale (from git history and device reports in prior sessions):

| Commit | Why not chosen as baseline |
|--------|---------------------------|
| `012fd616b` | Added bundle-identity + assembly deadline on a parallel branch; not on main line to `b9f60bc32` |
| `a15135fca` | Added request-scoped tracing + pipeline modules (pre-handoff stack) |
| `73e99cde2`–`e17cda02c` | Cumulative patches for 93% hang / orphan loop — reintroduced overlapping finalizers |
| `d5d5410da` | TSC/lint only — cherry-picked non-Coach files |

`b9f60bc32` is the last commit before the handoff/final-ticket patch stack (`b0241755e` … `e17cda02c`) that layered duplicate completion paths.

## 2. Changes after baseline (Coach-related)

### `coach.tsx` (+837 lines vs HEAD before reset)

- Orphan recovery in `useFocusEffect` (infinite update depth)
- OTA `prefetchAndMaybeApplyOta` on tab focus
- Multiple final-ticket paths: `deliverCoachTicket`, `patchInstantBoardScanTicket`, `deliverBoardScanTicket`, stream `resolveOutPicks`, dead-end effects
- `boardScanAppliesToRequest` blocking complete scans with shortfall legs

### New modules added after baseline (duplicates — **not** merged into baseline)

| Module | Role | Status on baseline branch |
|--------|------|---------------------------|
| `coachFinalHandoff.ts` | Handoff logging + snapshots | **Removed** — not on baseline |
| `coachFinalTicketAssembly.ts` | `executeFinalTicketHandoff` | **Removed** |
| `coachFinalTicketCompletion.ts` | Second completion wrapper | **Removed** |
| `coachPipelineFinalize.ts` | Pipeline correlation finalize | **Removed** |
| `coachRunTrace.ts` | Active request tracing | **Removed** |

### Replaced with single paths

| Concern | Single implementation |
|---------|----------------------|
| Final-ticket finalizer | `lib/coachFinalizeTicket.ts` → `finalizeCoachTicket()` |
| Build phase machine | `lib/coachStateMachine.ts` |
| Orphan recovery | One guarded `useEffect` keyed on `activeRequestId` |
| OTA on Coach focus | **Removed** (no prefetch until 5-leg stable) |

## 3. Duplicates found (report before deletion)

1. **`parlayBuildPhase` vs `coachBuildPhase`** — legacy AnalysisProgress mapping kept; `coachBuildPhase` is source of truth; `parlayBuildPhase` still set in stream paths (to be collapsed later).
2. **`finalizeCoachTicket` vs `finalizeCoachTicketForRequest` vs `deliverCoachBoardScanTicket`** — UI completion now goes through `runFinalizeCoachTicket` → `finalizeCoachTicket`; `finalizeCoachTicketForRequest` remains for variety/prefix gate only inside `deliverCoachTicket` salvage path.
3. **`deliverBoardScanTicket` / `patchInstantBoardScanTicket` / stream `resolveOutPicks`** — complete scans route through `runFinalizeCoachTicket` first.

## 4. Regression tests

See `lib/coachRegression.test.ts`:

- No merge markers in `coach.tsx`
- `PROP_MARKET_LABEL_MAP` defined
- `prefetchAndMaybeApplyOta` exported (OTA module intact; not called from Coach)
- Phase machine forward-only
- 5 / 3 / 0 candidate finalization
- Salvage never empty when candidates exist

## 5. Device gate (not yet passed)

Required before claiming fixed:

1. Fresh launch → Coach → 5-leg parlay → 100% + 5 cards
2. Repeat **3 consecutive times** without Metro restart or code changes
