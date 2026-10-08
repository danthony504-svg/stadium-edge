# Simulator V2 Phase B Report

**Branch:** `cursor/simulator-v2-phase-b-def8`  
**Base:** Phase A (`cursor/simulator-v2-phase-a-def8` / PR #646)  
**Status:** Shadow-only development. **Do not merge, deploy, or publish OTA** without separate review.

## Decision context (held)

1. **HOLD PR #649** — post-lean top-up changes stay unmerged.
2. Preserve production P0 and PR #648 protections.
3. Neither ESPN period OD override nor V1 fractional period model is treated as calibrated.
4. Phase B replaces independent period overwrite with joint conserved draws (this report).

## Architecture

```
Historical team form (quarter scored/allowed, FG pts for/against)
        │
        ▼
 quarterMeansForSide()  — blend own period offense × opp period defense
        │                 fallback: FG mean × league quarter shares
        ▼
 Seeded Mulberry32 RNG
        │
        ▼
 Per draw: shared pace factor → Poisson(λ_q) for Q1..Q4 home & away
        │
        ▼
 Derive H1=Q1+Q2, H2=Q3+Q4, FG=Q1+Q2+Q3+Q4   ← exact by construction
        │
        ▼
 SimV2ScenarioTensor (isFixture=false, modelId=football.joint.phase_b)
        │
        ├── validateScenarioConsistency (quarters + halves + derived halves)
        ├── settleMarket / settleAltLineBatch (ml, spread, total, team_total)
        └── calibration diagnostics (Brier, log loss, ECE, V1 compare)
                │
                ▼
 selectProductionSimResult → V1 under default flags (shadow-only)
```

**Key invariant:** Periods are the generative process. There is no post-hoc period probability overwrite that can make `sum(periods) ≠ FG`.

### Settlement

| Family | Path pattern | Notes |
|--------|--------------|--------|
| ML | `team.margin` / `team.marginByPeriod.*` | `home_wins` / `away_wins` |
| Spread / alt | margin + line | Book posted spread preserved; cover = score + spread > opp |
| Total | `team.totalFg` / `team.totalByPeriod.*` | Over/under vs book line |
| Team total | `team.homeFg` / period home/away | Over/under vs book line |

Provider American odds are echoed unchanged; V2 never invents prices.

### Flags (unchanged defaults)

`SIM_V2_ENABLED=off`, `SIM_V2_SHADOW_ONLY=on`, `SIM_V2_SERVE=off`, `SIM_V2_ACCEPTED_FAMILIES=empty`.

## Files changed

| Path | Role |
|------|------|
| `src/models/football/priors.ts` | NFL/NCAAF league quarter shares + FG means |
| `src/models/football/jointFootball.ts` | Joint generator + summarize |
| `src/models/football/markets.ts` | Market builders (settlement definitions) |
| `src/models/football/calibration.ts` | Brier/log-loss/ECE hooks + V1 frac compare |
| `src/models/football/index.ts` | Barrel |
| `src/models/index.ts` | Barrel |
| `src/engine/settle.ts` | Period total/margin paths; football sum group |
| `src/validation/consistency.ts` | Half↔quarter derived checks |
| `src/validation/unsupported.ts` | Register NFL/NCAAF Phase B families |
| `src/shadow/isolation.ts` | Shadow forbid error id |
| `src/index.ts` / `version.ts` / `package.json` / `README.md` | Phase B exports + 0.2.0 |
| `test/footballJoint.test.ts` | Conservation, settle, orientation, cal, isolation |
| `api-server/.../simulatorV2Shadow.ts` | Health/models advertise Phase B shadow model |
| `api-server/.../simulatorV2Bridge.ts` | Comment only — still V1 for Coach |
| `PHASE_B_REPORT.md` | This report |

**Not changed:** Coach UI, qualification thresholds, correlation rules, 48h window, prop sim caps, P0 blocks, OTA publish paths.

## Test results

```
pnpm --filter @workspace/simulator-v2 test     → 29/29 pass
pnpm --filter @workspace/simulator-v2 typecheck → pass
api-server simulatorV2Bridge.test.ts           → 3/3 pass
```

Coverage includes: exact Q/H/FG conservation every draw; deterministic seeds; home/away orientation; ML/spread/alt/total/team-total (+ Q2/H1 periods); odds echo; shadow isolation; V1 frac conservation break rate; calibration metric plumbing.

## Calibration evidence (synthetic / in-package)

10k-draw NFL fixture with distinct quarter form (`seed=phase-b-evidence`):

| Metric | Value |
|--------|-------|
| Joint FG total mean | **43.9** (home 22.8 + away 21.1) |
| Joint period-sum break rate | **0** |
| V1 frac period-sum break rate | **99.98%** of draws |
| V1 mean \|quarter-sum − FG\| | **0.72** pts/team-pair |
| Mean \|V2−V1\| period share Δ | **8.7 pp** |
| Share of comparisons ≥5 pp | **65.0%** |
| FG ML home hit | 0.551 |
| FG spread home −3.5 | 0.403 |
| FG total over 44.5 | 0.449 |
| Q2 home +3.5 | 0.869 (period scale; not OD-inflated ~0.95) |

Synthetic 8-game FG total calibration plumbing: Brier ≈ 0.253, log loss ≈ 0.698, ECE ≈ 0.051 — **not** an acceptance sample (n≪500; gates require n≥500, ECE≤0.04, shadow soak, etc.).

## Outstanding risks

1. **No real OOS outcomes yet** — acceptance gates will reject until multi-season historical settle + closing-line comparison lands.
2. **Poisson quarter scoring** ignores football scoring discreteness (TD/FG/safety structure) and drive dependence; defensible v0, not final.
3. **League priors** are anchors; small ESPN L4 samples (audit finding) still feed noisy λ when used as inputs.
4. **Q2 dog +3.5 ~87%** is structurally high on low quarter totals — better than V1 OD ~95%, still needs market-family calibration before any P0 lift.
5. **Stacks on #646** — Phase B must not merge ahead of Phase A platform.
6. **HOLD #649** remains; do not treat Phase B as permission to ship lean top-up.
7. **Production serve still forbidden** until explicit family acceptance + flag flip + separate review.

## Explicit non-actions

- No merge / deploy / OTA publish from this branch.
- No Coach UI / threshold / correlation / 48h / prop-cap changes.
- No P0 block removal.
- PR #649 stays held.
