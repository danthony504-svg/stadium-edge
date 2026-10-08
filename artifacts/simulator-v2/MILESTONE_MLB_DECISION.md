# Milestone — MLB calibration decision (discrimination audit)

Shadow-only. `SIM_V2_SERVE=off`. No allowlist / Coach / P0 / OTA.

## Verdict

**Do not accept v0.3 ECE gains that are only shrink-to-50.** ML and team_total flagged on frozen holdout; VAL ML separation worsened → **Option B**.

| Item | Result |
|------|--------|
| Default profile | **Changed** → `v0.3.1` (shrink 0.2 / σ0.22 / HFA 0.07) |
| Prior default | `v0.3` (shrink 0.4 / σ0.18 / HFA 0.05) retained as A/B profile only |
| Holdout | Frozen identical (`MLB_AB_HOLDOUT_GAMES.json`, n=560) |
| Tuning | VAL diagnostics only; **never** on holdout |
| Production serve | Still off / not accepted |

## Per-family decisions

| Family | Decision | Notes |
|--------|----------|-------|
| ml | **MODIFY** | Holdout shrink-to-50; VAL sep Δ≈−0.013; ECE still ≫0.04; loses to train home-win baseline on ECE |
| spread | **MODIFY** | VAL sep worsened; ECE still FAIL |
| total | **MODIFY** | ECE improved without shrink-to-50 but still FAIL; tails/varRatio collapsed |
| team_total | **MODIFY** | Holdout + VAL shrink-to-50; near-zero / negative separation |
| f5 | **KEEP** | A/B freeze v0.3 **PASS** (ECE 0.0397); VAL ECE≤0.04; not shrink-to-50. Disc-audit seed near gate |
| main_all | **MODIFY** | Aggregate still FAIL ECE |
| alt_all | **MODIFY** | Still FAIL ECE |
| player_prop_named | **MODIFY** | ECE FAIL; SP participation already fail-closed |
| closing_line | **INSUFFICIENT** | No licensed archive |

## Option B levers (VAL-informed, single step)

| Lever | v0.2 | v0.3 | **v0.3.1 (default)** |
|-------|------|------|----------------------|
| shrinkWeight | 0 | 0.4 | **0.2** |
| gameShockSigma | 0 | 0.18 | **0.22** |
| homeEdge | 0.1 | 0.05 | **0.07** |
| modelVersion | 0.2.0 | 0.3.0 | **0.3.1** |

Rationale (VAL): v0.3 cut ML separation via form collapse (mad½ 0.114→0.080) while between-game varRatio fell; half shrink + slightly higher σ restores discrimination headroom without a full revert to v0.2 (which would forfeit F5 ECE gains).

VAL confirmation (v0.3.1, not holdout-tuned): ML sep 0.030 (+0.006 vs v0.3), mad½ 0.091 (+0.011 vs v0.3), ECE 0.0985 (≈ v0.2). Still MODIFY / not accept.

## F5 vs FG ML

- F5 family cleared / near-clears ECE; FG ML remains worst family (ECE≈0.11, shrink-to-50).
- Same inning Poisson; F5 = 5/9 horizon → less cumulative overconfidence.
- **Starting pitcher participation: fail-closed** (`confirmedStarter === false` → `missing_data`). Team FG/F5 ML still do not use SP quality in means.

## Reports

- `eval/report/MLB_DISCRIMINATION_AUDIT.md`
- `eval/report/MLB_DISCRIMINATION_SUMMARY.json`
- `eval/report/MLB_AB_HOLDOUT.md` (prior A/B)

## Next milestone

**MLB F.3** — re-run discrimination / A/B including v0.3.1 on the frozen holdout; accept ml/team_total only if separation ≥ v0.2 and shrink-to-50 clears; wire SP into team means; closing-line archive still required for CL benchmark.

## Isolation

No Coach / qualification / correlation / allowlist / serve changes.
