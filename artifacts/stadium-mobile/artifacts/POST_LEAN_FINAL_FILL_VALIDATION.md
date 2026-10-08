# Post-lean final fill — implementation validation

**Branch:** `cursor/lean-preserve-qualified-def8`  
**SHA:** `f3d11169` (implementation commit; report may append)  
**Constraints honored:** no 48h expand, no sim-cap increase, no threshold/P0 loosening, no force-7, no V2, no merge/deploy/OTA.

## Changed files

| File | Change |
|------|--------|
| `lib/postLeanFinalFill.ts` | `topUpAfterMlLean` — reuse `topUpTicketFromQualifiedScored`; belt opposite-side same-period + ladder |
| `lib/postLeanFinalFill.test.ts` | 10 regression tests (7/9/15, P0, caps, duplicates, correlation, no-eligible, rejected fp) |
| `lib/coach/buildParlay.ts` | After lean + football finalize, one fill pass when `picks.length < target && !propsPending` |

## Progressive policy (unchanged)

| Target | `maxLegsPerGame` | Progressive raise | `maxPropsPerGame` |
|-------:|-----------------:|-------------------:|------------------:|
| 7 | 2 | **[3, 4]** | 2 |
| 9 | 2 | [3, 4, 5] | 2 |
| 15 | 2 | [3…8] | 2 |

No new caps; fill calls existing top-up which already owns the progressive ladder.

## Test results

```
lib/postLeanFinalFill.test.ts                         10/10 pass
+ mlLean / integrity / P0 / propGate / staging / …    86/86 pass (combined suite)
```

## Live probe (`7 leg NFL`, production API)

| Metric | Lean-preserve only (prior) | **With post-lean fill** |
|--------|---------------------------:|------------------------:|
| Final ticket | 4 | **6** |
| Elapsed | ~11–12s | **~15.3s** |
| Qualified pool | ~109 | 111 |
| Forced to 7? | no | **no** (honest shortfall) |

### Exact ticket

| # | Event | Market | Pick | Odds | Grade | simHit | Role |
|--:|-------|--------|------|-----:|------:|-------:|------|
| 1 | TB @ DAL | Rec Yds | CeeDee Lamb Over 84.5 | −112 | B | 0.733 | prop (cap) |
| 2 | TB @ DAL | Rec Yds | Jake Ferguson Under 26.5 | −111 | B− | 0.639 | prop (cap) |
| 3 | TB @ DAL | Q1 Alt Spread | Cowboys +3.5 | −690 | B+ | 0.909 | lean seat |
| 4 | TB @ DAL | 1H Alt Spread | Buccaneers +12.5 | −350 | B+ | 0.986 | preserved |
| **5** | TB @ DAL | **Q2 Spread** | **Buccaneers +3.5** | **−104** | **B+** | **0.954** | **final fill** |
| **6** | TB @ DAL | **Alt Spread** | **Buccaneers +18.5** | **−340** | **B** | **0.928** | **final fill** |

### Correlation decisions (5th / 6th)

| Pick | Ladder key | Why allowed |
|------|------------|-------------|
| Bucs Q2 +3.5 | `…\|q2:spread\|buccaneers` | Distinct period vs Cowboys Q1 + Bucs 1H; not opposite-side same period; progressive raise seats #3 GL |
| Bucs FG Alt +18.5 | `…\|spread\|buccaneers` | Distinct FG settlement family; progressive raise seats #4 GL; not Q1 opposite of Cowboys |

**Rejected for 7th:** `maxPropsPerGame(7)=2` (Pickens/Dak props) and progressive GL ceiling **4** — pool exhausted under approved caps.

**Opposite-side belt:** Bucs Q1 not seated beside Cowboys Q1 (same `q1:spread` family, opposite side).

## vs production path

| Path | Result |
|------|--------|
| Production tip (pre this fix): lean shrink, no refill | **2–4** |
| This branch lean-preserve only | **4** |
| This branch + post-lean fill | **6** |
| Reach 7 on 1-game 48h NFL | Still **impossible** under current caps |

## Safety checklist

- [x] Reuses production top-up / progressive / ladder / prop caps / P0  
- [x] Preserves provider odds + `finalAiScore` + simHit  
- [x] No second lean pass  
- [x] Does not reintroduce rejected fingerprints when provided  
- [x] No 48h / sim-cap / threshold changes  
- [x] Does not force 7  

**Do not merge / OTA until reviewed.**
