# Replacement model proposal — dedicated college team-strength (pre-implementation)

**Status:** PROPOSAL ONLY — do **not** implement or spend until human approve.  
**Context:** TUNING round closed unsuccessful ([`ncaaf-tuning-round-closed-unsuccessful.md`](./ncaaf-tuning-round-closed-unsuccessful.md)).  
**Criteria:** Locked M1–M4 / S1–S4 **unchanged**. FINAL_EVAL **untouched**. Closes **eval-only** — never train or tune against closing prices.  
**Ops:** `NCAAF_GAME_LINE_SIM_VALIDATED=false` · no deploy/OTA · voice paused.

## 1. Problem statement (from preserved TUNING evidence)

The current research path is NFL-shaped **drive simulation** fed by short-horizon PPG form + `teamMean(for, oppAgainst)`:

| Failure mode | Evidence (TUNING fair n≈421) |
|--------------|------------------------------|
| ML vs market | Best Δ ≈ **0.032** (need ≤ **0.02**); locked ~0.052 |
| ATS vs coin | Locked ~**0.29**; opp-adj **worse** (~0.31) |
| Margin compression | meanPred ~8.5 vs meanAct ~10.7; large favs pred 11.5 vs act 22+ |
| Early season | W1 thin form; prior-season carry **worsened** W1 bias when naïvely swapped in |
| Structure | Engine ≈ logistic(strengthGap); drive layer adds little ML discrimination |

Incremental levers (gap scale, margin-history blend, drop `teamMean`, prior→W1, opp-adj) failed slice-aware gates. **Architecture replacement** is the next research step — not another residual/scale knob.

## 2. Proposed replacement vs current drive sim

### Current: `ppg-per-drive-v1.1-research` (drive sim)

| Aspect | Behavior |
|--------|----------|
| State | Per-team recent PPG for/against (venue/L10 blend) |
| Matchup | `teamMean` offense with opponent defense PPG → expected drives → score rates → Monte Carlo |
| Uncertainty | Residual SD **14.5** + home shrink **2.0** (locked); gap scale default 1.0 |
| Early season | Relies on thin 2025 form; 2024 only via walker history if present in prior fixtures |
| SOS | Implicit only (who you played is in the PPG average) — no explicit schedule adjustment |
| Large mismatches | Compressed by blending + shared drive geometry; blowouts systematically under-predicted |

### Proposed: dedicated **college team-strength** model (research stamp TBD)

A separable strength layer that outputs **pregame** μ_margin / σ_margin (and optional home-win logit), then a thin calibration map to ML/ATS probs — **without** NFL drive geometry as the primary college scorer.

| Aspect | Proposed handling |
|--------|-------------------|
| **Team strength** | Latent offense/defense (or single net) ratings with **explicit SOS** (opponent-adjusted scoring / iterative Massey- or Elo-style college ratings on FBS-only graphs) |
| **Early-season uncertainty** | Hierarchical prior: 2024 end-of-season rating + **week-varying variance** (σ inflated for weeks 1–3 / low game counts); blend weight prior↔season-to-date that shrinks as `n_games` grows — not a hard week-1 swap that discarded live form |
| **Schedule strength** | Each rating update uses opponent strength at **prediction time** (causal); optional future-SOS feature **only** from already-known completed games (never from closes) |
| **Large mismatches** | Heavy-tailed margin likelihood (e.g. Student-t or mixture) or explicit blowout mass so P(large margin) is not choked by Gaussian residual 14.5 alone; optional FCS/FBS indicator as a **known pregame** categorical (name/division), not a post-hoc patch |
| **vs drive sim** | Drive sim may remain as an **optional residual module** later; v1 replacement scores ML/ATS from strength μ/σ directly so college asymmetry is first-class |

**Design rule:** Closing prices stay **out of training and feature construction**. Market appears only in locked eval metrics (M3) after predictions are frozen.

## 3. Side-by-side comparison (research)

| Dimension | Drive sim (current) | College team-strength (proposed) |
|-----------|---------------------|----------------------------------|
| Primary object | Drive rates from PPG | Team ratings + margin distribution |
| NFL coupling | Shares `nflDriveSim` path | College-only research stamp; NFL live untouched |
| Early week | Thin PPG / failed prior swap | Prior + inflated σ + smooth blend |
| SOS | Buried in PPG | Explicit opponent adjustment |
| Blowouts | Systematic under-prediction | Heavy tail / mismatch features |
| ML discrimination | ≈ logistic(gap) | Direct rating gap (+ SOS) |
| ATS | Fails coin; opp-adj hurt ATS | Requires calibrated σ vs spread line |
| Implementation risk | Already built | New module + eval harness |

## 4. Required inputs (available vs missing)

### Available now (no new paid Odds)

| Input | Source | Notes |
|-------|--------|-------|
| 2025 TUNING finals + kickoffs | `ncaaf-tuning-2025-w1-7-games.json` | 471 games |
| 2023–2024 finals | `ncaaf-phase-e-games.json` | Prior seed / SOS |
| TUNING closes (eval only) | `ncaaf-tuning-2025-w1-7-closing-lines.json` | **Scoring only** — 470/471 |
| Causal walk timing | `walkHoldoutGames` / completion stamps | Pregame form discipline |
| FCS name heuristics | Existing research scripts | Imperfect |

### Missing / blocked (do not invent)

| Gap | Impact | Acquisition |
|-----|--------|-------------|
| FINAL_EVAL ESPN + closes | Cannot claim restore | Deferred until TUNING replacement **passes** locked criteria on TUNING first |
| Clean FBS/FCS division IDs | SOS graph pollution | Prefer ESPN group/conference IDs vs name regex (free ESPN) |
| Injury pre-kick freezes | E4 still blocked | Forward collector only; never backfill |
| Closing totals / ALT prices | Totals/ALT markets | Separate paid pull — **out of scope** for this proposal |
| Neutral-site / conference flags | Home strength | ESPN venue/conference (free) if not already on rows |
| Preseason “market” lines | Tempting but **forbidden** as features if used to chase M3 | Do not use |

## 5. Implementation scope (when approved — not now)

**In scope (research-only):**

1. New research stamp, e.g. `ncaaf-team-strength-v0-research`, gated like today’s research path (NFL live stamp unchanged).  
2. Offline rating fit on 2024 (+ optional 2023) FBS games; causal online update through 2025 TUNING weeks.  
3. Early-season prior blend + week/`n_games`-dependent σ.  
4. Margin → ML/ATS probability map (parametric); **no** close prices in fit.  
5. Reuse existing TUNING fair cohort + time-ordered / slice-aware reject harness (`ncaafTuningIsolatedLevers.ts` pattern).  
6. Docs + fixtures for scorecards; gate stays false.

**Out of scope until separate approval:**

- FINAL_EVAL fixture build or scoring  
- Paid Odds (totals/ALTs/T−24h)  
- Live product wiring / `NCAAF_GAME_LINE_SIM_VALIDATED` flip  
- Deploy, OTA, voice resume  
- Tuning residual 14.5 / shrink 2.0 as a “pass M3” knob  
- Training loss that includes market close Brier or implied probs  

**Effort character (technical, not calendar):** New research module + offline scripts; moderate invasive surface (college-only). No Render/mobile change required for the proposal phase.

## 6. Evaluation design (criteria unchanged)

### Data discipline

| Split | Use |
|-------|-----|
| 2024 (+2023) | Rating seed / hyperparameter selection **without** 2025 closes |
| TUNING 2025 w1–7 | Primary acceptance screen for the replacement |
| FINAL_EVAL | Frozen; score **once** only after TUNING PASS — no retune |

Closes join **after** predictions; never in features or training objective.

### Metrics (locked thresholds — do not edit)

- **M3:** `brierEngine ≤ brierMarketClose + 0.02`  
- **S2:** ATS Brier `< 0.25` (pushes excluded)  
- Also report M1/M2/M4, S1/S3/S4 as already locked  

### Slice-aware gates (from this TUNING round — keep)

Reject candidates that improve aggregate ML/ATS while worsening:

- Week 1 (and w1–3) ML Δ vs market or margin under-prediction bias  
- Large favorites (**14+**) ATS Brier or blowout margin bias  

Use identical fair cohort (games with full close ML+spread) for all models.

### Time-ordered protocol

1. Fit priors on ≤2024 only.  
2. Walk 2025 TUNING in kickoff order; update ratings only **after** each game’s prediction.  
3. Expanding-week folds + by-favorite-size tables (same as isolated-levers report).  
4. No peek at FINAL_EVAL labels or closes.

### Pass / fail

| Outcome | Action |
|---------|--------|
| TUNING M3+S2 PASS + slice gates | Freeze replacement params; **then** build FINAL_EVAL once |
| TUNING FAIL | Keep gate false; document; do not relax criteria |
| Slice FAIL / aggregate PASS | **REJECT** (same rule that killed opp-adj) |

## 7. Recommendation

1. **Close** drive-sim TUNING incremental work as unsuccessful (done).  
2. **Approve** (human) research spike for `ncaaf-team-strength-v0-research` per this proposal — still no paid spend required for a first offline build on existing ESPN + eval-only closes.  
3. Keep product blocked until TUNING PASS under locked criteria.

## 8. Explicit non-actions this document authorizes

- No code merge that changes live NCAAF scoring  
- No FINAL_EVAL retrieval  
- No Odds purchase/upgrade  
- No deploy / OTA / voice  
- No criteria edits after seeing scores  
