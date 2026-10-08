# Milestone — MLB F.2+ historical validation & calibration (shadow)

## Scope
- Shadow-only. `SIM_V2_SERVE=off`. No allowlist population. No Coach / P0 / PR#649 / merge / deploy / OTA.
- Chronological OOS with family gates (`eval/familyCalibration.ts` + `eval/runMlbChronoOos.ts`).
- Smallest generative correction in `jointBaseball.ts` → model version **0.3.0**.

## Root cause (ML ECE 0.2289 on F.2 @ v0.2.0)
Independent per-inning Poisson draws with **fixed** team means produce underdispersed FG/margin distributions. Combined with **raw recent form** (no league shrinkage) and a **0.1 home edge**, home ML probabilities clustered too far from 0.5 → **overconfident ML ECE ≈ 0.229**.

## Model correction (`baseball.joint.v0` 0.3.0)
1. Shrink offense/defense form **40%** toward `MLB_TEAM_FG_MEAN` (4.45).
2. Per-draw **lognormal game shock** on team means (`σ ≈ 0.18`).
3. Milder home edge **0.05** (was 0.1).

## Holdout protocol
- ESPN MLB **date-sample** (week API empty); dense daily Apr–Jun + Aug–Sep, seasons 2023–2024.
- Chronological **55 / 20 / 25** train / val / holdout. Val diagnostic only; **never tune on holdout**.
- Graded 560 holdout games (target ≥500 obs/family). Grid −110 (not closing lines).

## Family gates (final holdout)

| Family | Verdict | n | ECE | notes |
|--------|---------|---|-----|-------|
| mlb:ml | **FAIL** | 560 | 0.1095 | improved vs 0.2289; still >0.04 |
| mlb:spread | **FAIL** | 1120 | 0.0567 | main + alt RL |
| mlb:total | **FAIL** | 1120 | 0.0495 | 8.5 + alt 10.5 |
| mlb:team_total | **FAIL** | 560 | 0.0665 | home 4.5 |
| mlb:f5 | **FAIL** | 1680 | 0.0411 | F5 ML/total/alt; barely over gate |
| mlb:main_all | **FAIL** | 3360 | 0.0590 | |
| mlb:alt_all | **FAIL** | 1680 | 0.0606 | |
| mlb:closing_line_benchmark | **INSUFFICIENT_DATA** | 0 | — | no licensed CL source |
| mlb:player_prop_named | **FAIL** | 2880 | 0.0919 | ESPN boxscore athlete IDs (hits/HR/K); 120/120 games |

Full tables: `eval/report/MLB_CHRONO_OOS.md`, `eval/report/MLB_FAMILY_GATES.md`.

## Distribution check
- Totals mean err ≈ −0.04 (well centered).
- Between-game sim-mean variance still low vs actual outcomes (varRatio ≈ 0.02) — residual underdispersion / heavy shrinkage; market ECE remains above 0.04.

## Verification
- `npm test` — 42 pass
- `npm run typecheck` — pass
- `npm run eval:mlb-oos` — pass (writes reports)

## SHAs
- Code (familyCalibration + joint v0.3 + OOS harness): `fe22154d8cd255b95e82135ad5f1ff53c8916b53`
- Reports + this milestone: `75044b5e00685e3a3de3b178a3f7e525f21920f7`

## Isolation
- Production allowlists empty; serve flag off.
- No Coach / qualification / correlation production changes.
