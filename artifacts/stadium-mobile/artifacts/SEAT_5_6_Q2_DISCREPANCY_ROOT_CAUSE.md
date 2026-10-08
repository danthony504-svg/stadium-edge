# Q2 0.954 vs 0.868 — root cause & release readiness

**Branch:** `cursor/lean-preserve-qualified-def8`  
**PR:** #649  
**Constraints:** no merge/OTA; no threshold loosen; no 48h expand; no Simulator V2.

---

## Exact root cause

The 8.6pp gap was **not** a settlement bug, wrong side, FG↔Q2 mismatch, or random-seed sampling error on the same path.

| Path | Code | Q2 Bucs +3.5 hit |
|------|------|-----------------:|
| Prior “independent” check | `fetchCoachGameSimulationsForPicks` → **server frac-only** `periodScoresForDraw` (flat 0.24 share) | **0.862–0.868** |
| Production board scan | `fetchSlateGameSimulationsWithStatus` → same FG outcomes → **overwrite** period `coverHitRates` with ESPN period offense/defense shares | **0.949–0.951** |
| Original ticket claim | Board-scan `finalAiScore.simHit` | **0.954** |

**Reproduction on one FG draw set + live ESPN period stats (TB@DAL, sampleSize=4 each):**

| Quantity | Value |
|----------|------:|
| Server / frac-only | 0.863 |
| Period-OD re-derive | **0.949** |
| Claimed ticket | 0.954 |
| Δ claimed vs OD | **0.5pp** (within period-noise repeats 0.949–0.951) |
| Δ OD vs frac | **+8.7pp** (= reported discrepancy) |

### Period-OD inputs (live)

| Team | Q2 scored / allowed | Blended Q2 expected | FG from period avgs | Q2 share |
|------|---------------------|--------------------:|--------------------:|---------:|
| Home (DAL) | 5.0 / 8.3 | 6.3 | 27.4 | **0.230** |
| Away (TB) | 5.0 / 7.5 | 6.7 | 23.6 | **0.284** |

Away Q2 share > home → Bucs period margin inflated vs flat 0.24 → +3.5 covers more often. Opposite side is deflated (Cowboys Q2 +1.5: frac 0.650 → OD 0.383, **−26.7pp**).

Settlement definition is identical on both paths: `awayScore_period + 3.5 > homeScore_period`, period=`q2`, teamSide=`away`. Model version / FG MC inputs are the same; only the **period share layer** differs.

### Was the prior check independent?

**No (not apples-to-apples).** Same market id and game, but it skipped the board-scan period-OD overwrite. FG Alt +18.5 was unaffected (FG queries are not re-derived) → 0.4pp gap only.

---

## Edge / EV from verified production probability

Production path hit for seat 5 = **0.949** (period-OD). Displayed `finalAiScore.simHit` / edge / EV are derived from that same `coverHitRates` value used for `qualifiesAltPick`.

| Source | Fair | Implied (−104) | Edge | EV | qualifiesAlt |
|--------|-----:|---------------:|-----:|---:|:------------:|
| Ticket claimed 0.954 | 0.954 | 50.98% | 44.4 | 87.1% | true |
| **Production OD 0.949** | **0.949** | 50.98% | **43.9** | **86.1%** | **true** |
| Frac-only 0.862 (wrong path) | 0.862 | 50.98% | 35.2 | 69.1% | true |

Seat 6 FG +18.5 −340: indep **0.920–0.924**, edge ~15%, EV ~19%, qualifiesAlt true. Grades/EV match the probability used to qualify.

---

## Systematic quarter-spread shift (NFL; NCAAF uses same path)

On 56 synthetic ladder rows (Q1–Q4 × ±1.5…7.5 both sides) with TB@DAL period stats:

| Metric | Value |
|--------|------:|
| Mean Δ (OD − frac) | **−1.4pp** (not global one-way inflation) |
| Mean \|Δ\| | **6.8pp** |
| Rows with \|Δ\| ≥ 5pp | **25 / 56** |
| Max lift | Cowboys Q3 +1.5: +16.4pp |
| Max drop | Cowboys Q2 +1.5: −26.7pp |
| Bucs Q2 +3.5 | **+8.1pp** |

`wantsPeriodStats` includes **nfl, ncaaf, nba** — same overwrite applies to NCAAF quarter spreads whenever ESPN period averages exist. Small samples (here n=4) amplify share asymmetry.

This is **existing board-scan grading behavior**, not introduced by post-lean fill.

---

## Six-pick correlation & fill gates

| Check | Result |
|-------|--------|
| Hard same-ladder / opposite-side same-period | **none** |
| Soft ≥28 | Bucs 1H ↔ Bucs FG Alt (+28) only — existing soft penalty |
| Progressive GL | `[3,4]` ceiling 4 (PR #547) |
| P0 unvalidated totals via fill | **blocked** (`p0UnvalidatedSimTotalDecision` + `scoredLegFromQualifiedCandidate` null) |
| Unsupported markets | Not in NFL qualified pool; fill only consumes pre-qualified candidates |

---

## Correction applied this turn

1. **`applyPeriodOffenseDefenseCoverRates`** — shared helper.
2. **`fetchCoachGameSimulationsForPicks`** now fetches period stats and applies the same overwrite as board scan (closes the verification / supplement path gap).
3. **Regression:** `lib/coachGameMonteCarlo.periodOd.test.ts` — asymmetric Q2 share lifts Bucs +3.5 vs frac; FG unchanged; no-op without period avgs.

No qualification, correlation, P0, 48h, or V2 changes.

---

## Test results (this turn)

| Suite | Result |
|-------|--------|
| `coachGameMonteCarlo.periodOd.test.ts` | **2/2** |
| `gamePeriodScoring.test.ts` | **4/4** |
| `coachP0UnvalidatedTotals.test.ts` | **8/8** |
| `postLeanFinalFill.test.ts` | **10/10** |
| `mlLeanEnforcement.test.ts` | **21/21** |
| `gameSimScoring.test.ts` | **10/10** |
| **Combined** | **55/55** |

---

## Release readiness

| Item | Status |
|------|--------|
| Q2 discrepancy explained | **Yes** — period-OD vs frac-only path mismatch |
| Seat 5 production simHit | **~0.949** ≈ claimed 0.954; settlement OK |
| Seat 6 | **OK** under existing gates |
| Fill / correlation / P0 | **OK** |
| Path consistency correction | **Shipped on branch** (picks fetch ≡ slate OD) |
| Extreme edge vs −104 (~44pp) | **Known calibration risk** of period-OD + small ESPN samples + inflated FG MC totals — **not introduced by #649**; separate from fill merge |
| Merge / OTA | **Still hold for human review** — fill feature is coherent; period-spread calibration is pre-existing product risk |

**Verdict:** Correction required for the **verification/supplement path** (done). **No correction required to post-lean fill qualification logic.** PR #649 remains **not merge-ready until reviewer accepts** the documented period-OD grading (and residual high edge on Q2 −104) as existing approved behavior.
