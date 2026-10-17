# Next-stage proposal — missing team-strength inputs (no implementation / no spend)

**Status:** PROPOSAL ONLY — do **not** implement, purchase, or wire until human approve.  
**Context:** Restoration attempt closed on identical-334 ([`ncaaf-restoration-attempt-closed-334.md`](./ncaaf-restoration-attempt-closed-334.md)).  
**Preserved:** verified FBS/FCS classification, explicit unsupported/unrated withhold, research stamp `ncaaf-team-strength-v0-research`.  
**Ops:** FINAL_EVAL untouched · `NCAAF_GAME_LINE_SIM_VALIDATED=false` · production freeze · no deploy/OTA · voice paused.

## 1. What remains wrong (supported FBS–FBS only)

On identical **n=334** (verified after):

| Issue | Evidence |
|-------|----------|
| ML vs market | Δ ≈ **0.024** (need ≤ **0.02** for M3) |
| ATS vs coin | Brier ≈ **0.257** (need &lt; **0.25** for S2) |
| Large favorites | 14+ n=94: Δ ≈ 0.058, bias ≈ **−6.6** |
| Early season | W1 n=47: ML Δ ≈ 0.072 |
| Transition teams | 2 unrated first FBS games (Delaware, Missouri State) — correctly withheld today |

FBS–FCS is **out of scope** (Coach withhold) — do not chase it with fitted cupcake strengths.

## 2. Candidate inputs (address remaining errors)

Ranked by expected relevance to supported FBS–FBS errors. **No arbitrary strength constants chosen to fit TUNING closes.**

| # | Input | Why it could help | Source | Cost / acquisition | Fits without inventing μ? |
|---|--------|-------------------|--------|--------------------|---------------------------|
| A | **Neutral-site + conference flags** on game rows | Wrong HFA on neutrals / conference title sites compresses or flips early margins | ESPN competition / venue fields (free) on existing event IDs | **$0** — free ESPN; cache-only retag of phase-e + TUNING rows | Yes — categorical feature / HFA off switch |
| B | **Returning production / QB continuity (pregame)** | Large-fav and W1 errors partly from roster discontinuity not in PPG ratings | ESPN athlete/depth or free injury+QB status freeze at kickoff | **$0** if ESPN-only snapshots; forward collector already sketched for E4 | Yes — categorical / missing→withhold |
| C | **Pregame injury freeze (known-at-kick)** | E4 still open; sudden QB/OL outs inflate residual error | Forward ESPN injury snapshot (no backfill) | **$0** ESPN; **no** paid Odds | Yes — null stays null; never impute from closes |
| D | **Verified “new FBS” prior protocol** | Delaware / Missouri State unrated at first FBS–FBS | Season-specific IDs already have transitions; optional prior from **prior-season FCS schedule strength vs FBS opponents only** (cache phase-e) or explicit **withhold until n≥1 FBS–FBS** (current) | **$0** cache-only | Yes if protocol is declared *before* scoring — not fitted to 334 outcomes |
| E | **Travel / rest (days since last game, timezone)** | Mid-week / cross-country spots add ATS noise | Kickoff + prior game timestamps already on fixtures | **$0** derived | Yes |
| F | **Closing totals / ALT prices** | Totals/ALT markets only — not primary ML/ATS fix | The Odds API historical | **Paid** — out of scope until ML/ATS pass; do not buy now | N/A for this proposal |
| G | **Market open/close as features** | Tempting for M3 | Odds | **Forbidden** as features (eval-only forever) | No — rejected |

**Not recommended next:** another residual/gap knob on drive sim; silent default-24 for FCS; training loss that includes market Brier.

## 3. Evaluation design — TUNING is **not** independent proof

Locked policy ([`ncaaf-reserved-eval-acceptance-criteria.md`](./ncaaf-reserved-eval-acceptance-criteria.md)):

| Split | Role |
|-------|------|
| **TUNING** 2025 w1–7 (incl. identical 334) | **Screening / selection only** — already used; cannot be cited as independent restore proof |
| **FINAL_EVAL** 2025 w8+ (+ completed 2026 when built) | **Single frozen acceptance** — untouched until a candidate is locked on TUNING screen |

### How to evaluate new inputs without pretending TUNING is holdout

1. **Declare** the input protocol and any priors **before** looking at FINAL_EVAL (and without shopping thresholds).  
2. On TUNING, use **time-ordered nested folds** (e.g. expand by week: train ≤ w_{k−1}, score w_k) only to **select** which inputs survive slice gates (W1 / 14+ / no FBS–FCS leakage).  
3. **Freeze** the chosen input set + hyperparameters (no close prices in the objective).  
4. **Build FINAL_EVAL once** (ESPN + eval-only closes) and score **once**. A TUNING “pass” is necessary but **not sufficient** for restore claims.  
5. Report readiness **by market** (ML vs ATS) and **by scope** (supported FBS–FBS vs withhold FBS–FCS).  

If nested TUNING folds disagree with the frozen 334 scorecard direction, **do not** average toward closes — drop the input.

## 4. Suggested sequence (when approved — still no spend here)

1. **A + E** (neutral/conference + rest/travel) — free, cache-adjacent, lowest risk.  
2. **D** — document new-FBS prior **or** keep withhold-until-rated (current).  
3. **B + C** — forward injury/QB continuity collector (free ESPN); no historical fantasy backfill.  
4. Re-screen on TUNING nested folds → freeze → **then** FINAL_EVAL once.  
5. Totals/ALTs (F) only after ML/ATS restore path clears.

## 5. Explicit non-actions this document authorizes

- No code merge that changes live NCAAF scoring  
- No FINAL_EVAL fixture retrieval  
- No Odds purchase/upgrade  
- No deploy / OTA / voice  
- No criteria edits after seeing scores  
- No treating FBS–FCS withhold volume as a model failure or success  

## 6. Product parallel track

While NCAAF restore stays closed/blocked, resume **Coach verification and release for already-tested supported-sport fixes** on separate PRs (gate false / NCAAF P0 armed unchanged).
