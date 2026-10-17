# NCAAF restoration candidate — evidence pack

**Research tip:** `ppg-per-drive-v1.1-research` (opt-in only)  
**Live engine:** `nfl-drive:ppg-per-drive-v1` (Render `e607f131`) — **isolated; unchanged**  
**Product gate:** `NCAAF_GAME_LINE_SIM_VALIDATED = false` — **do not flip**  
**Ops:** No publish/deploy; voice paused; production OTA freeze armed. **E6 not requested.**

## Verdict: restore readiness **NO** (no market enabled)

**TUNING round CLOSED UNSUCCESSFUL** (2026-10-17) — drive-sim levers exhausted; see [`ncaaf-tuning-round-closed-unsuccessful.md`](./ncaaf-tuning-round-closed-unsuccessful.md). Replacement proposal (not implemented): [`ncaaf-replacement-team-strength-proposal.md`](./ncaaf-replacement-team-strength-proposal.md).

Per-market readiness is **independent**. Locked criteria are **not** lowered. 2024 USED holdout is **not** fresh acceptance evidence.

| Market | Evidence | vs locked criteria | Restore? |
|--------|----------|--------------------|----------|
| **Moneyline** | Fair n=421 close-joined: locked ML Brier ~0.202, Δ vs market ~0.052; best opp-adj Δ~0.032 — **M3 FAIL** | M3 not met | **NO** |
| **Spreads** | Locked ATS Brier ~0.29; opp-adj worse (~0.31) — **S2 FAIL** | S2 not met | **NO** |
| **Totals** | No `closeTotal` archive | INSUFFICIENT_DATA | **BLOCKED** |
| **ALTs** | No posted ALT prices | INSUFFICIENT_DATA | **BLOCKED** |

## Holdout / split policy

| Window | Status |
|--------|--------|
| 2024 pre-cutoff + post-cutoff | **USED** — diagnosis only; no retune of residual 14.5 / shrink 2.0 |
| **TUNING** 2025 weeks 1–7 | ESPN **471** + closes archive **470/471** (eval-only); round **closed unsuccessful** |
| **FINAL_EVAL** 2025 w8+ / completed 2026 | **Untouched** — counted only (~416 + ~455); **no fixture written** |

Criteria locked in [`ncaaf-reserved-eval-acceptance-criteria.md`](./ncaaf-reserved-eval-acceptance-criteria.md).

## Diagnosis — team strength / matchup (TUNING)

Artifacts: `ncaaf-tuning-team-strength-diag.json`, `ncaaf-tuning-margin-bins.json`, `ncaaf-tuning-margin-scale-sweep.json`.

| Finding | Evidence |
|---------|----------|
| ML ranks outcomes | Quintile meanY monotone; corr(p,y)≈0.36 on TUNING |
| Home-win under-forecast | meanP 0.64 vs meanY 0.71 (bias ≈ −7.5 pp, near M4 band) |
| Equal for/against blend OK | Weight sweep 0.35/0.5/0.65 — **0.5 best** Brier |
| Spreads weak / margins compressed | Pred margin mean 9.8 vs actual 13.9; fair-line ATS Brier > coin; large-gap bins worst |
| USED 2024 (hypothesis only) | ATS Brier 0.264 > coin; \|line\| 21+ calibration inverted in pre-cutoff margin diag |

## Proposed research change (not live)

| Lever | Detail |
|-------|--------|
| **ID** | `ncaaf_research_margin_gap_scale` |
| **Mechanism** | Expand home/away PPG gap about midpoint after defense tilt, research path only |
| **Default** | **1.0** (no-op) — residual/shrink locks unchanged |
| **TUNING candidate** | ~**1.45** (best ML Brier) / **1.6** (first ATS fair-line &lt; coin, synthetic) |
| **Env** | `NCAAF_RESEARCH_MARGIN_GAP_SCALE` for offline sweeps |
| **Code** | `applyNcaafResearchMarginGapScale` in `footballDriveMatchup.ts` / `nflDriveSim.ts` |
| **Ship rule** | Do not lock or enable for restore until Odds closes on TUNING pass S2/M3; never use FINAL_EVAL to retune |

## Historical retrieval (next purchase)

See [`ncaaf-historical-retrieval-2025-2026.md`](./ncaaf-historical-retrieval-2025-2026.md).

**Concrete next step:** inject `ODDS_API_KEY` + approve **hard cap 4 500 credits** (base **3 540** = 177 × 20) for TUNING close `h2h,spreads`. Dollar impact if already on a paid plan: **$0** incremental invoice (quota value ≈ $5.31 on 20K/$30). Defer FINAL_EVAL Odds (~3 120) and 2026 (~3 400) until TUNING market criteria are scored. Params + M3/S2 locked in [`ncaaf-model-params-locked.md`](./ncaaf-model-params-locked.md).

## Engine isolation

Live stamp `ppg-per-drive-v1`. Research opt-in only. NFL ignores research flags. Details: [`ncaaf-engine-isolation.md`](./ncaaf-engine-isolation.md).

## What remains (no E6)

1. Human review of replacement team-strength **proposal** (no impl/spend until approved).  
2. If approved: implement research stamp offline; screen on TUNING with locked M3/S2 + slice gates; **do not** train on closes.  
3. Only after TUNING PASS → build FINAL_EVAL once (no retune).  
4. Totals/ALTs stay blocked until archives exist.  
5. Keep gate false; no deploy/OTA; voice paused.
