# PR #649 seats 5–6 — independent pre-merge verification

**Branch:** `cursor/lean-preserve-qualified-def8`  
**SHA:** `869f57a4e0804e53d4bcbb862e3860e58fe03744`  
**Ask:** `7 leg NFL` (1-game 48h TNF: TB @ DAL)  
**Constraints honored:** no merge / deploy / OTA; no qualification, correlation, or P0 weakening; no 48h expand; no Simulator V2.

Artifacts: `/tmp/verify-proposed-seats.json`, `/tmp/diag-post-lean-fill-live.json` (original proposed ticket).

---

## Proposed seats (from live fill that identified them)

| # | Market | Pick | Odds | Grade | Ticket simHit | Role |
|--:|--------|------|-----:|------:|--------------:|------|
| 5 | Q2 Spread | Buccaneers +3.5 | −104 | B+ | **0.954** | post-lean fill |
| 6 | Alt Spread | Buccaneers +18.5 | −340 | B | **0.928** | post-lean fill |

Original full ticket (diag): CeeDee 84.5 / Ferguson U26.5 / Cowboys Q1 +3.5 −690 / Bucs 1H +12.5 −350 / **+ seats 5–6**.

Live boards drift: later runs seated Q2 Alt +2.5 / 2H Alt +13.5 instead of FG +18.5. Verification below targets the **proposed** seats via fresh 10k outcomes.

---

## 1. Settlement / period / grading (independent)

| Check | Seat 5 (Q2 +3.5) | Seat 6 (FG +18.5) |
|-------|------------------|-------------------|
| `buildGameCoverQuery` | `kind:spread`, `teamSide:away`, `line:3.5`, **`period:q2`** | `kind:spread`, `teamSide:away`, `line:18.5`, **`period:fg`** |
| Mapping fallback to FG | **false** | **false** (already FG) |
| Wrong-side settlement | Opposite Cowboys −3.5 hit **0.130**; sum with primary **0.998** | Opposite Cowboys −18.5 hit **0.076**; sum **1.000** |
| Fresh cover from 10k outcomes | **0.868** | **0.924** |
| Frac-only recompute (no period OD profile) | 0.870 | 0.924 |
| Ticket / claimed simHit | 0.954 | 0.928 / live pool 0.922 |
| Δ (independent − claimed) | **−0.086** | −0.004 / −0.002 |

Sim meta (fresh fetch): `simulations=10000`, homeProj **41.55**, awayProj **42.53** (total ~**84.1** vs market FG total ~48.5), homeWin 0.436 / awayWin 0.523. `periodOffenseDefense` **absent** on this fetch.

---

## 2. Q2 +3.5 @ −104 → why ~95%? Inflation check

| Hypothesis | Finding |
|------------|---------|
| Full-game graded as Q2 | **Rejected** — query period is `q2`; `mappingFallbackToFg=false` |
| Wrong team side | **Rejected** — away Bucs; opposite home −3.5 complements (~0.998) |
| Ticket 0.954 exact? | **Not reproduced** — independent 10k = **0.868** (Δ −8.6pp) |
| Still over-edged vs book? | **Yes** — even at 0.868, implied at −104 is **50.98%** → edge **35.8%** / EV **70.3%** |
| Driver | Game sim projects ~**84** total points and near-pick’em margin (mean ~+1 away, σ~13.5). Period spreads inherit that scoring mass; P0 fail-closed applies to **totals/team totals**, not period spreads |

**Verdict on seat 5:** Period/side settlement are correct. Claimed **0.954 is inflated vs fresh recompute (0.868)**. Residual edge vs −104 remains large under current gates — **do not treat 95.4% as independently confirmed**.

---

## 3. Implied / fair / EV (provider odds × matched sim)

### Seat 5 — Bucs Q2 +3.5 @ **−104**

| Source | Implied | Fair (simHit) | Edge | EV | Fair American |
|--------|--------:|--------------:|-----:|---:|--------------:|
| Ticket / claimed | 50.98% | 95.4% | 44.4 | 87.1% | −2074 |
| **Independent 10k** | 50.98% | **86.8%** | **35.8** | **70.3%** | −658 |

### Seat 6 — Bucs FG Alt +18.5 @ **−340**

| Source | Implied | Fair (simHit) | Edge | EV | Fair American |
|--------|--------:|--------------:|-----:|---:|--------------:|
| Claimed (diag) | 77.27% | 92.8% | 15.5 | 20.1% | −1289 |
| Live pool score | 77.27% | 92.2% | 14.9 | 19.3% | −1182 |
| **Independent 10k** | 77.27% | **92.4%** | **15.1** | **19.6%** | −1216 |

---

## 4. −340 price / edge / qualification (seat 6)

`qualifiesAltPick` gates (unchanged): grade ≥ **C+**, confidence ≥ **52**, `simAligned`, edge **> 0**, simHit **>** implied, EV **> 0**.

| Gate | Live pool @ −340 | Independent @ −340 |
|------|------------------|--------------------|
| Grade | B ≥ C+ | B (assumed for indep check) |
| Confidence | 66 ≥ 52 | 62+ |
| Edge | 14.9 > 0 | 15.1 > 0 |
| EV | 19.3% > 0 | 19.6% > 0 |
| sim > implied | 0.922 > 0.773 | 0.924 > 0.773 |
| `qualifiesAlt` | **true** | **true** |
| `recommends` / boardRole | false / **alt** | — |

**Not accepted solely for high hit rate** — price (−340 → 77.3% implied) still leaves positive edge/EV under matched sim.

---

## 5. Full six-pick correlation (proposed shape)

Analyzed ticket: 2 props + Cowboys Q1 + Bucs 1H + **proposed Q2** + **proposed FG Alt**.

| Pair | sameLadder | oppositeSamePeriod | softPenalty |
|------|:----------:|:------------------:|------------:|
| Bucs 1H +12.5 ↔ Bucs FG +18.5 | false | false | **+28** |
| Cowboys Q1 ↔ Bucs Q2 / 1H / FG | false | false | +14 |
| Props ↔ GLs | false | false | +7 |
| Hard opposite-side same-period | — | **none** | — |

GL count **4** / prop count **2** on one event. Soft same-team multi-period correlation is penalized, not hard-blocked (existing policy).

---

## 6. Progressive game-line cap #4 — existing policy

```text
maxLegsPerGame(7) = 2
progressiveLegsPerGameRelaxation(7) = [3, 4]   // ceiling = ceil(7/2) = 4
```

Blame: `progressiveLegsPerGameRelaxation` introduced in **PR #547** (`2a0116e2`, 2026-09-27). This PR only **reuses** `topUpTicketFromQualifiedScored` — does **not** raise the ceiling. Fifth GL correctly blocked at ceiling 4.

---

## 7. Post-lean fill cannot reintroduce invalids

`topUpAfterMlLean` → `buildFillPool`:

- Skips `rejectedFingerprints` and already-used fingerprints  
- Belts opposite-side same-period + duplicate ladders  
- `scoredLegFromQualifiedCandidate` requires odds, score, board role; blocks P0 unvalidated totals; requires sim grade on GL spreads  

Probe: marking both proposed seats as rejected → fill **reintroducedCount = 0**. P0 Q2 Total candidate → `scoredLegFromQualifiedCandidate` null.

---

## 8. Test results

| Suite | Result |
|-------|--------|
| `lib/postLeanFinalFill.test.ts` | **10/10** |
| `lib/mlLeanEnforcement.test.ts` | **21/21** |
| `lib/coachP0UnvalidatedTotals.test.ts` | **8/8** |
| `lib/parlayCorrelationScore.test.ts` | **12/12** |
| `lib/gameSimScoring.test.ts` | **10/10** |
| `lib/gamePeriodScoring.test.ts` | **4/4** |
| `lib/ticketStaging.test.ts` | **18/18** |
| `lib/boardLegQualification.test.ts` | **2/2** |
| `lib/gameSimDistReuse.test.ts` | **12/12** |
| `artifacts/api-server/test/rosterGrounding.test.ts` | **12/12** |
| `lib/coachQa/coachQa.harness.test.ts` (live skipped) | **9 pass / 2 skipped / 0 fail** |
| `lib/pickRecommendation.test.ts` | **31/32** (1 pre-existing: `sanitizeCoachTicketPicks` startsAt) |
| **Seat-relevant suites (excl. pickRec fail)** | **118 pass / 0 fail** (live QA skipped) |

### Pre-existing failures (out of seat scope)

| Suite | Issue |
|-------|-------|
| `lib/pickRecommendation.test.ts` | Duplicate import fixed this turn; remaining fail: `sanitizeCoachTicketPicks keeps all qualified legs when only some have startsAt` (1≠2) — unrelated to fill/lean |
| `lib/simMarketSupport.test.ts` | `marketSupportsSimulation("Both Teams To Score", soccer)` now true vs expected false |

No qualification / correlation / P0 thresholds were changed for this verification.

---

## Changed files on branch (vs `main`)

| File | Role |
|------|------|
| `lib/postLeanFinalFill.ts` | Post-lean top-up + opposite-period belt |
| `lib/postLeanFinalFill.test.ts` | 10 regression tests |
| `lib/coach/buildParlay.ts` | Wire fill after lean |
| `lib/mlLeanEnforcement.ts` / `.test.ts` | Preserve qualified anti-lean + hard GL revalidation |
| `artifacts/POST_LEAN_FINAL_FILL_VALIDATION.md` | Prior live 4→6 report |
| `artifacts/COACH_FINAL_FILL_SHORTFALL.md` | Shortfall investigation |
| `artifacts/LEAN_FINAL_VALIDATION.md` | Lean-preserve validation |
| `scripts/leanFinalValidationProbe.mjs` | Probe |

---

## Review recommendation

| Seat | Independent status |
|------|--------------------|
| **6 — FG Alt +18.5 −340** | Settlement OK; simHit **~0.924** matches claim; qualifiesAlt on price/edge/EV — **acceptable under existing gates** |
| **5 — Q2 +3.5 −104** | Settlement/period OK; **claimed 0.954 not reproduced (indep 0.868)**; residual edge still extreme vs −104 / inflated FG scoring — **flag for reviewer; do not cite 95.4% as verified** |

**Do not merge, deploy, or publish OTA until reviewed.** Honest shortfall to 6 (not force-7) remains correct under progressive GL ceiling 4 + prop cap 2 on this 1-game slate.
