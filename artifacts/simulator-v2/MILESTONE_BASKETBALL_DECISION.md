# Basketball decision — REVERT blanket v0.3

## Decision: **REVERT**
Restore default generative levers to **v0.2** (pre-correction). Keep settlement builders, date-sample OOS, familyCalibration, A/B harness, and `calibrationProfile` for eval-only ablations.

## Why
Identical-holdout A/B showed v0.3 **worsened**:
| League | Family | v0.2 ECE | v0.3 ECE |
|--------|--------|----------|----------|
| NBA | main_all | 0.049 | **0.061** |
| WNBA | main_all | 0.057 | **0.080** |
| NCAAB | main_all | **0.040 PASS** | **0.075 FAIL** |

NBA totals improved under v0.3 but must not approve a package that regresses main_all / ML.

## Default parameters (restored)
| Lever | Value |
|-------|-------|
| shrinkWeight | 0 |
| shockSigma | 0 |
| HFA NBA / WNBA / NCAAB | 2.4 / 2.4 / 3.2 |
| modelVersion | **0.2.0** |

Eval-only profiles: `v0.3`, `ablate_shrink`, `ablate_shock`, `ablate_hfa`.

## NCAAB prior PASS scope
A/B `ncaab:main_all` v0.2: n=1584, ECE=0.0396 → familyCalibration **PASS** (minOos + maxEce only).
**Not** a full `evaluateAcceptanceGate` serve pass (still needs shadow soak, contract tests, latency p95, integrity reject rate).

## Files
- `src/models/basketball/jointBasketball.ts` — default profile v0.2
- `eval/runBasketballAblation.ts` — one-factor ablations
- `eval/report/BASKETBALL_ABLATION.md`
- Retained: `runBasketballAbHoldout.ts`, markets, settle tests

## Next milestone (E.3)
1. Finish val ablations; promote **one** factor only if it improves ECE **and** Brier/LL without hurting ML on all three leagues.
2. Wire named-player prop OOS.
3. Game-specific spreads (not fixed −3.5 grid) before re-judging spread families.
4. Keep leagues independently gated.

## Isolation
SIM_V2_SERVE=off; allowlists empty; no Coach/P0/PR#649/merge/OTA.
