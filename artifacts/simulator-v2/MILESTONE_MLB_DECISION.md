# Milestone — MLB calibration decision (F.5 update)

Shadow-only. `SIM_V2_SERVE=off`. No allowlist / Coach / P0 / OTA.

## Verdict

**Default profile remains `v0.3.1`.** Candidate `v0.3.2` (strength-preserve form) improved VAL ML separation and mad½ without shrink-to-50, but **one-shot holdout ML ECE / Brier / LL worsened** → do not promote.

| Item | Result |
|------|--------|
| Default profile | **`v0.3.1`** (shrink 0.2 / σ0.22 / HFA 0.07) |
| Candidate (A/B only) | `v0.3.2` (shrink 0.1 / σ0.24 / HFA 0.08 / strengthPreserve 0.45 / formResidual 0.3) |
| Holdout | Frozen identical (`MLB_AB_HOLDOUT_GAMES.json`, n=560) |
| Tuning | VAL diagnostics only; holdout applied **once** for promotion |
| Production serve | Still off / not accepted |

## Per-family decisions

| Family | Decision | Notes |
|--------|----------|-------|
| ml | **MODIFY** | Holdout ECE 0.1074 (v0.3.1); v0.3.2 worse ECE 0.1163; no shrink-to-50 on 0.3.1→0.3.2; still ≫0.04 |
| spread | **MODIFY** | ECE still FAIL |
| total | **MODIFY** | ECE still FAIL |
| team_total | **MODIFY** | Holdout ECE 0.0914; v0.3.2 worse; near-zero / negative separation |
| f5 | **MODIFY** | Under default v0.3.1 holdout ECE **0.0486** (FAIL near-gate). Prior A/B freeze PASS was on **v0.3** seed; not production allowlist |
| main_all | **MODIFY** | Aggregate still FAIL ECE |
| alt_all | **MODIFY** | Still FAIL ECE |
| player_prop_named | **MODIFY** | Aggregate FAIL; **hits PASS**; HR/RBI/SB FAIL; K INSUFFICIENT (n=240) |
| closing_line | **INSUFFICIENT** | No licensed archive |

## Profile levers

| Lever | v0.2 | v0.3 | **v0.3.1 (default)** | v0.3.2 (candidate) |
|-------|------|------|----------------------|--------------------|
| shrinkWeight | 0 | 0.4 | **0.2** | 0.1 |
| gameShockSigma | 0 | 0.18 | **0.22** | 0.24 |
| homeEdge | 0.1 | 0.05 | **0.07** | 0.08 |
| strengthPreserve | 0 | 0 | **0** | 0.45 |
| formResidualWeight | 0 | 0 | **0** | 0.3 |
| modelVersion | 0.2.0 | 0.3.0 | **0.3.1** | 0.3.2 |

## F.5 acceptance snapshot (default v0.3.1)

| Family | n | games | effN | Brier | LogLoss | ECE | ECE_SE | p95 ms | Verdict |
|--------|---|-------|------|-------|---------|-----|--------|--------|---------|
| f5 | 1680 | 560 | 560.0 | 0.2531 | 0.7004 | 0.0486 | 0.0098 | 1.5 | FAIL |

Settlement integrity: F5⊆FG on 10k draws (`test/baseballJoint.test.ts`). SP/batting-order fail-closed preserved.

## FG ML promotion (v0.3.1 → v0.3.2, holdout once)

| Criterion | Result |
|-----------|--------|
| ECE improved | no (0.1074 → 0.1163) |
| shrink-to-50 | ok (not FLAG) |
| Brier / LL non-regression | no |
| **Decision** | **MODIFY** — keep default v0.3.1 |

## Reports

- `eval/report/MLB_F5_ACCEPTANCE.md`
- `eval/report/MLB_F5_ACCEPTANCE_SUMMARY.json`
- `eval/report/MLB_DISCRIMINATION_AUDIT.md` (prior)
- `MILESTONE_MLB_F5.md`

## Next

- Further FG ML work on VAL only (SP-aware team means; variance/tails) before another holdout shot
- F5: recover ≤0.04 under default without sacrificing FG discrimination
- Closing-line archive still required for CL benchmark
- Named prop calibration (HR/RBI/SB/K) after team FG path stabilizes

## Isolation

No Coach / qualification / correlation / allowlist / serve changes.
