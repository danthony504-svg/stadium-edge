# Milestone — Football prop decision (post–named-athlete A/B)

## Decision: **KEEP**

Keep named-athlete identity grounding and prop model **0.3.2**.  
Do **not** bump to 0.3.3. No generative coefficient change.

Shadow-only. No `SIM_V2_SERVE`, allowlists, Coach, P0, PR#649, merge, or OTA.

## Identity (KEEP — do not weaken)

| Item | Status |
|------|--------|
| Named ESPN `athlete.id` (`/^\d{3,}$/`) | **Required** |
| Proxies (`home_qb`, …) | **Rejected** — never graded |
| Files | `eval/footballPropIdentity.ts`, OOS/A/B/family diagnose harnesses |

## Exact params (unchanged)

| Param | Value |
|-------|-------|
| `FOOTBALL_PROP_MODEL_VERSION` | `"0.3.2"` |
| `FOOTBALL_PROP_YARD_BUDGET_SHOCK_SIGMA` | `0.12` |
| `FOOTBALL_PROP_TD_RATE_TEMPER` | `1.0` |
| Pass budget | `5.8·pts + 90` |
| Rush budget | `2.0·pts + 40` |
| Rec budget | `3.6·pts + 55` |

**Param deltas vs 0.3.2:** none.

Shadow-only eval knobs (`propEvalKnobs`) exist for val probes; defaults preserve 0.3.2 RNG/fingerprint.

## Why not MODIFY (INSUFFICIENT)

Val-fold probes (NFL 2023 / NCAAF 2024 w1–7), holdout untouched for fitting:

| Candidate | Val result | Blocker |
|-----------|------------|---------|
| `shock_0.16` | Mild ECE dips (NFL −0.004, NCAAF −0.007); any_td flat | Below clear multi-family win bar |
| `td_temper_0.75` | NFL any_td ECE −0.015 | **Unsafe:** holdout RB gap +0.26 vs WR −0.11 — uniform temper trades roles |
| `shock_0.16_td_0.75` | NCAAF ECE −0.009; NFL any_td −0.017 | Same TD lever + **NFL p95 hit 0.828→0.783** |

Residual holdout ECE (NFL ≈0.057, NCAAF ≈0.074) and anytime TD ECE ≈0.148 remain; fixing them needs a **role-aware** TD generative redesign (and/or rush/rec dispersion), not a one-knob holdout tune.

## Holdout Brier / LogLoss (untouched chrono, v0.3.2)

| Sport | Family | n | Brier | LogLoss | ECE | ECE_SE |
|-------|--------|---|-------|---------|-----|--------|
| NFL | player_prop | 8480 | 0.1736 | 0.5310 | 0.0574 | 0.0051 |
| NFL | any_td | 1644 | 0.2397 | 0.6815 | 0.1482 | 0.0106 |
| NCAAF | player_prop | 11990 | 0.1891 | 0.5688 | 0.0740 | 0.0051 |
| NCAAF | any_td | 2301 | 0.2179 | 0.6350 | 0.1130 | 0.0072 |

Full per-family table: `FOOTBALL_FAMILY_DIAGNOSE.md` / `eval/report/FOOTBALL_FAMILY_DIAGNOSE.md`.

## Files

| Path | Role |
|------|------|
| `src/models/football/playerProps.ts` | 0.3.2 + shadow `propEvalKnobs` |
| `eval/footballPropIdentity.ts` | Named-id gate |
| `eval/runFootballPropFamilyDiagnose.ts` | Family diagnose + val probes |
| `eval/runFootballPropAbHoldout.ts` | Prior A/B (unchanged decision) |
| `FOOTBALL_FAMILY_DIAGNOSE.md` | Family metrics report |
| `MILESTONE_FOOTBALL_DECISION.md` | This decision |

## Next validation milestone

**C.2.3 — Role-aware anytime-TD + rush/rec dispersion (val-only)**

1. Split generative any_td: QB pass-TD vs skill rush/rec scorer rates (RB down, WR up toward leader occurrence).
2. Val-fold target: NFL/NCAAF `any_td` ECE ↓ and RB/WR rate gaps same sign / \|gap\|&lt;0.08; no p95 hit regression.
3. Optional: rush alt over-sharpness (higher shock or role usage noise) if val supports without pass_yds regression.
4. Re-run frozen holdout once; bump to **0.3.3** only after val clear win.
5. Closing-line family remains INSUFFICIENT until licensed archive.

## Commands

```bash
pnpm test
pnpm typecheck
pnpm eval:prop-family
```

## Non-goals

Serve flags, family allowlists, Coach wiring, production OTA.
