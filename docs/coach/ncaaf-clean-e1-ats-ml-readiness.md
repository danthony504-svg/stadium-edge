# E1 α=1.15 — ATS diagnosis + ML readiness

**Stamp:** `ncaaf-score-margin-v1-research`  
**Candidate:** **α=1.15 FROZEN** · margin-scale sweeps **STOPPED**  
**Generated:** 2026-10-17T12:05:34.403Z  
**Ops:** FINAL_EVAL untouched · NCAAF blocked · injury OPEN · freeze · voice paused · no spend/deploy/OTA

## 1. Candidate freeze

| Item | Value |
|------|-------|
| Research candidate | E1 **α=1.15** |
| A0 | Archived baseline reference |
| Further α / margin sweeps | **No** |

## 2. ATS error diagnosis (identical-334)

### 2a. Overall / large / location vs shape

| Slice | nATS | ATS Brier | mean resid ± SE | mean cover resid | ATS Brier after oracle +μ | location share |
|-------|-----:|----------:|----------------:|-----------------:|--------------------------:|---------------:|
| overall | 326 | 0.2603 | 2.892±0.91 | 2.956 | 0.2573 | 0.0030 |
| large>14 | 94 | 0.2633 | 6.371±1.63 | 6.371 | 0.2597 | 0.0036 |

Interpretation: Location correction barely moves ATS Brier ⇒ remaining error is mostly shape/calibration.

Reliability (y ~ p): slope=0.1972 intercept=0.4284 (n=326). Ideal slope≈1, intercept≈0.

### 2b. Calibration by predicted cover probability

| Bin | n | mean P | mean Y | P−Y | Brier |
|----:|--:|-------:|-------:|----:|------:|
| [0.02,0.2) | 3 | 0.1647 | 0.0000 | 0.1647 | 0.0276 |
| [0.2,0.35) | 44 | 0.2989 | 0.5000 | -0.2011 | 0.2855 |
| [0.35,0.5) | 152 | 0.4321 | 0.5197 | -0.0877 | 0.2603 |
| [0.5,0.65) | 107 | 0.5623 | 0.5421 | 0.0203 | 0.2501 |
| [0.65,0.8) | 18 | 0.6988 | 0.5556 | 0.1432 | 0.2786 |
| [0.8,0.98) | 2 | 0.8599 | 0.5000 | 0.3599 | 0.4371 |

### 2c. Time-ordered week folds

| Week | nATS | ATS Brier | mean resid | loc-corrected ATS | ML Δ |
|-----:|-----:|----------:|-----------:|------------------:|-----:|
| W1 | 47 | 0.2433 | 3.663 | 0.2486 | 0.0697 |
| W2 | 39 | 0.2674 | 2.700 | 0.2608 | 0.0261 |
| W3 | 44 | 0.2803 | 5.371 | 0.2550 | 0.0104 |
| W4 | 46 | 0.2497 | 0.323 | 0.2498 | -0.0157 |
| W5 | 48 | 0.2541 | 0.897 | 0.2535 | 0.0140 |
| W6 | 49 | 0.2769 | 4.573 | 0.2757 | 0.0249 |
| W7 | 53 | 0.2530 | 2.816 | 0.2484 | 0.0050 |

## 3. Proposed next experiment

**NO_EXPERIMENT** — `NONE`



**Rationale:** ATS error not isolatable to one bounded lever. locShare=0.0030, atsAfterLoc=0.2572857234787137, reliabilitySlope=0.19722008072068167, meanZ2Cover=0.6684401612889699, sigmaDirectionConflict=true, discriminationOk=false. Margin-scale sweeps frozen; do not invent β/α scalars.



## 4. Moneyline readiness (independent; thresholds unchanged)

| Criterion | TUNING screen (E1 α=1.15) | FINAL_EVAL / product |
|-----------|---------------------------|----------------------|
| M1 n≥200 | n=334 (screen ok) | **BLOCKED** — FINAL_EVAL empty |
| M2 Brier&lt;0.25 | 0.1955 (true) | unscored |
| M3 ≤ mkt+0.02 | Δ=0.0188 (true) | **TUNING ≠ FINAL_EVAL** |
| M4 |bias|≤0.08 | -0.0656 | unscored |
| S2 ATS&lt;0.25 | 0.2603 (**fail**) | unscored |
| Coach CLV C1–C6 | not measured on clean E1; phase-e last=undefined n=undefined | **BLOCKED** (early cache / spend) |
| E4 injury | non-null injury=0 qb=0 | **OPEN** |
| P2 gate | false | must stay false |

**Moneyline ready for FINAL_EVAL?** **NO**  
**Moneyline ready for product?** **NO**  
TUNING-only M3 screen insufficient; FINAL_EVAL empty; Coach CLV blocked; injury E4 open; ATS S2 fail; gate false by policy

## 5. Remaining blockers (no threshold changes)

- **FINAL_EVAL_EMPTY** (hard): Reserved FINAL_EVAL fixtures/closes not built — no acceptance scoring allowed
- **ATS_S2_FAIL_TUNING** (hard): E1 α=1.15 identical-334 ATS Brier=0.2603 (need <0.25). Descriptive only on TUNING.
- **COACH_CLV** (hard): C1–C6 unmet on last phase-e measure; clean candidate has no early two-sided cache; spend not authorized
- **E4_INJURY** (hard): injuryKnown/qbOut null on TUNING closes; no historical pre-kick joins
- **TUNING_M3_NOT_FINAL** (policy): Even if TUNING M3 screen is true for E1 α=1.15, policy forbids treating it as FINAL_EVAL authorization
- **GATE_P2** (policy): NCAAF_GAME_LINE_SIM_VALIDATED must stay false until human E6
- **TOTALS_ALTS_DATA** (market): closeTotal / posted ALT prices absent → INSUFFICIENT_DATA

Fixture: `artifacts/api-server/test/fixtures/ncaaf-clean-e1-ats-ml-readiness.json`
