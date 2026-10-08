# Milestone — MLB F.5 acceptance evidence (shadow)

Shadow-only. `SIM_V2_SERVE=off`. **Still NOT production allowlist.**

## Deliverables

| Item | Path / result |
|------|----------------|
| Acceptance harness | `eval/runMlbF5Acceptance.ts` (`npm run eval:mlb-f5`) |
| Report | `eval/report/MLB_F5_ACCEPTANCE.md` |
| Summary JSON | `eval/report/MLB_F5_ACCEPTANCE_SUMMARY.json` |
| Default decision | `eval/report/MLB_F5_DEFAULT_DECISION.json` → **keep v0.3.1** |
| 10k F5⊆FG unit test | `test/baseballJoint.test.ts` (`SIM_V2_DEEP_DRAWS=10000`) |

## F5 family (frozen holdout, default v0.3.1)

| n | games | effN | Brier | LogLoss | ECE | ECE_SE | p95 ms | Verdict |
|---|-------|------|-------|---------|-----|--------|--------|---------|
| 1680 | 560 | 560.0 | 0.2531 | 0.7004 | 0.0486 | 0.0098 | 1.5 | **FAIL** (ece>0.04; near-gate) |

Thresholds unchanged: minOos=500, maxEce=0.04. Settlement: F5⊆FG conserved on 10k draws (unit test). SP / batting-order **fail-closed** preserved.

## FG ML / team_total rework (v0.3.2)

VAL-informed candidate `v0.3.2`: shrink 0.1 / σ0.24 / HFA 0.08 / strengthPreserve 0.45 / formResidual 0.3.

| Check (holdout ML, once) | Result |
|--------------------------|--------|
| ECE improved vs v0.3.1 | **false** (0.1074 → 0.1163) |
| shrink-to-50 FLAG | **false** |
| Brier / LL non-regression | **false** |
| Promote default | **false** |
| FG ML decision | **MODIFY** |

VAL had modest ML sep↑ (+0.006) and ECE↓; holdout did not confirm — default remains **v0.3.1**.

## Named props (separate gates)

| Gate | n | Verdict |
|------|---|---------|
| player_prop_named | 5040 | FAIL |
| prop_hits | 1200 | PASS |
| prop_hr | 1200 | FAIL |
| prop_k | 240 | INSUFFICIENT_DATA |
| prop_rbi | 1200 | FAIL |
| prop_sb | 1200 | FAIL |

## Blockers

- F5 family ECE 0.0486 > 0.04 under current default (near-gate; not allowlisted)
- FG ML / team_total still FAIL ECE; v0.3.2 not promoted
- Closing-line archive still INSUFFICIENT
- Production serve / allowlist / Coach untouched

## Isolation

No Coach / qualification / correlation / allowlist / OTA / serve changes.
