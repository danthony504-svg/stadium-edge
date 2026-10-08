# Lean-preserve correction — final pre-release validation

**Branch:** `cursor/lean-preserve-qualified-def8`  
**Commit:** `6f455e5c30744e0db9a9cfc41402daf229a78213`  
**Base:** `origin/main` @ `24698920`  
**PR:** https://github.com/danthony504-svg/stadium-edge/pull/649  
**Date:** 2026-10-08  

**Constraints honored:** no 48h window change; no simulation-cap increase; no qualification/correlation loosening; Simulator V2 not enabled; no merge/deploy/OTA in this validation pass.

## Changed files (vs `origin/main`)

| File | Role |
|------|------|
| `artifacts/stadium-mobile/lib/mlLeanEnforcement.ts` | Preserve qualified anti-lean originals; hard `maxLegsPerGame` revalidation; no progressive raise |
| `artifacts/stadium-mobile/lib/mlLeanEnforcement.test.ts` | TNF scenarios + preserve/reject/P0/duplicate/cap cases (21 tests) |
| `artifacts/stadium-mobile/lib/coach/buildParlay.ts` | Pass `requestedLegs: target` into lean enforcement |

## Scenario outcomes (probe + unit tests)

| Scenario | Pre-fix | Post-fix | Notes |
|----------|-----------|------------|-------|
| Staged-only (no lean subs) | 2 | **4** | 2 props + Bucs Q1 + Bucs 1H preserved |
| Live (1 Q1 Cowboys sub) | 3 | **4** | 1 swap + Bucs 1H keep + 2 props |
| Four Cowboys period subs | 6 | **4** | 2 swaps; Q2/2H blocked by hard per-game GL cap |

### 1. Cowboys period distinctness (four-subs)

Final game-line seats:

| Market | Pick | Ladder key |
|--------|------|------------|
| Q1 Alt Spread | Cowboys +2.5 | `buccaneers\|cowboys\|q1:spread\|cowboys` |
| 1H Alt Spread | Cowboys +4.5 | `buccaneers\|cowboys\|1h:spread\|cowboys` |

- `wouldRepeatMarketLadder` between them: **false**
- Not duplicate full-game spread ladders (no bare `|spread|` FG keys)
- Distinct permitted settlement periods: **q1** vs **1h**

### 2. Evidence on all four final picks (every scenario)

All three scenarios end with **4** picks; each retains:

- Real provider odds (non-null finite non-zero)
- `finalAiScore` with grade
- Simulation evidence (`simHit` finite)
- Qualification status (`isLeanQualifiedSubstitute` for GLs; scored props via staging path)

Probe `allStrict`: staged ✓ · live ✓ · four-subs ✓

### 3. Bucs Q1 + 1H — period-overlap / correlation policy

| Policy layer | Decision |
|--------------|----------|
| Settlement ladders | **Distinct** — `q1:spread` vs `1h:spread`; `wouldRepeatMarketLadder` = false |
| Soft `parlayCorrelationPenalty(1H \| [Q1])` | **+28** — `sameTeamNearIdenticalLadder` (line delta `|13.5−6.5|=7` ≤ spread threshold 7). Reference: +14.5 would be **+14** (delta 8 > 7); same pick **+22** |
| Soft penalty for Q2 given Q1+1H | **+42** (accumulates vs both seated GLs) |
| Hard `maxLegsPerGame(7)` | **2** — second GL **allowed**; third (Q2) **blocked** |
| `collapseSameTeamGameLineSides` | Collapses four Bucs periods → **1** side (staging select path) |
| Lean finalize | Uses **hard cap only** (no progressive thin-slate raise; soft penalty not a lean seat gate) |

Staged-only final ticket keeps Bucs Q1 +6.5 and Bucs 1H +13.5 under the hard cap of 2.

### 4. Preserve only when final ticket eligibility holds

- Qualified anti-lean with no substitute → **preserved** (Buccaneers +6.5)
- Three Bucs period GLs with no subs → **2 kept, 1 dropped** (hard cap)
- Preserve path still requires `isLeanQualifiedSubstitute` + `passesLeanTicketConstraints`

### 5. Invalid originals never retained

| Case | Result |
|------|--------|
| Ungraded (no `finalAiScore`) | dropped |
| Missing / non-finite odds | dropped |
| Missing `simHit` / no sim grade | dropped |
| P0-blocked team total | `p0UnvalidatedSimTotalDecision` true; not lean-qualified; never swapped in |
| Duplicate FG ladder (nick vs full-name alt) | one seat kept; opposing dropped |

### 6. Regression suites

| Suite | Result |
|-------|--------|
| `mlLeanEnforcement.test.ts` | **21/21 pass** |
| Coach integrity + P0 + propGameTeamGate + ticketStaging + boardLegQualification + marketLadderExhaustion | **76/76 pass** (core lean/P0 set) |
| Broader set (+ noRepeatLegs, balancedTicketMix, simMarketSupport, ask filters) | **166/167** — 1 pre-existing fail (below) |
| `api-server` rosterGrounding + athleteIdentityCache | **25/25 pass** |
| `api-server` coach slate balanced / game-side / qualification / explicitMarketLock | **13/13 pass** |

### 7. vs current production (`origin/main`)

- Production `mlLeanEnforcement.test.ts`: **9 tests**, T4 still **drops** opposing with no replacement (destructive).
- This branch: **21 tests**, T4 **preserves** under hard caps; TNF scenarios assert 2→4, 3→4, 6→4.
- **No new failures introduced by this correction.**
- Shared pre-existing failure on both main and branch:  
  `simMarketSupport.test.ts` — `marketSupportsSimulation rejects unknown game markets` (`true !== false`). **Unrelated** to lean files (0-line diff vs main on `simMarketSupport.*`).

### 8. Deploy / OTA recommendation

| Surface | Needed? |
|---------|---------|
| **Expo OTA** (`stadium-mobile`) | **Yes, after review/merge** — lean enforcement + `buildParlay` call-site ship in the mobile Coach client |
| **Render (api-server)** | **No** for this correction — no api-server code changes |

**Do not merge or publish until this validation is reviewed.**

## Repro

```bash
cd artifacts/stadium-mobile
node --import ./test/register-hooks.mjs scripts/leanFinalValidationProbe.mjs
node --import ./test/register-hooks.mjs --test \
  lib/mlLeanEnforcement.test.ts \
  lib/coachTicketIntegrityRegression.test.ts \
  lib/coachP0UnvalidatedTotals.test.ts \
  lib/propGameTeamGate.test.ts \
  lib/ticketStaging.test.ts \
  lib/boardLegQualification.test.ts \
  lib/marketLadderExhaustion.test.ts
cd ../api-server
node --import ./test/register-hooks.mjs --test \
  test/rosterGrounding.test.ts \
  test/athleteIdentityCache.test.ts
```
