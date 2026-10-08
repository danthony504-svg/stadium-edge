# Simulator V2 — Parallel Development Plan

**Status:** Approved for development planning.  
**Foundation:** Shared V2 platform (schemas, settle, flags, shadow, metrics).  
**Gates:** Independent `sport:family` — empty allowlist; serve off.  
**Forbidden:** Merge PR #649 · enable unvalidated period spreads · reuse football scoring for other sports · deploy/OTA · Coach/P0/correlation/no-filler changes.

## 1. Parallel streams (no football wait)

Football calibration **does not block** other sports. Each stream owns its generative model, features, settlement maps, and eval harness. Shared code is only the V2 foundation under `src/{schemas,engine,flags,shadow,metrics,validation,seed}`.

| Stream | Branch pattern | Owns | Must not touch |
|--------|----------------|------|----------------|
| **Foundation** | `cursor/sim-v2-foundation-*-def8` | Shared settle/flags/archive schemas, coverage matrix tooling | Sport generative models; Coach UI |
| **Football B+C** | `cursor/simulator-v2-phase-b-correct-def8` (current) → `cursor/sim-v2-football-props-*-def8` | NFL/NCAAF joint scoring + Phase C prop plan/impl | Other sports’ `models/*` |
| **Hockey** | `cursor/sim-v2-nhl-*-def8` | NHL joint periods + props | Football params; basketball |
| **Basketball** | `cursor/sim-v2-basketball-*-def8` | NBA/WNBA/NCAAB (separate param packs + flags) | Football; hockey |
| **Baseball** | `cursor/sim-v2-mlb-*-def8` | MLB F5/innings + batter/pitcher props | Other scoring engines |
| **Soccer** | `cursor/sim-v2-soccer-*-def8` | Multi-league goals + specials + sparse props | Tennis combat |
| **Tennis** | `cursor/sim-v2-tennis-*-def8` | Set/game joint | Soccer |
| **Combat** | `cursor/sim-v2-combat-*-def8` | UFC/MMA/Boxing method×rounds×winner | Team-sport engines |
| **Closing-line archive** | `cursor/sim-v2-cl-archive-*-def8` | Capture/store design + permissioned ingest | Model acceptance flips |
| **Coverage matrix** | can land on foundation or football B branch | Matrix rows + CI reporter | Enabling serve |

Base PRs on `cursor/ota-recovery-path-def8` or `main` per current agent base; **do not** stack sport streams on unfinished football calibration unless sharing a pure foundation PR.

### Merge rules

1. Sport PRs may merge to the integration branch **only** as shadow code with `isMarketFamilySupported` still false for that sport (or family not in allowlist).
2. Never set `SIM_V2_ACCEPTED_FAMILIES` / `SIM_V2_SERVE` in a sport PR.
3. Cross-stream shared changes go through a **foundation** PR first; sport PRs rebase onto it.
4. PR #649 remains HOLD — no resume, no cherry-pick of its period-spread enablement.

## 2. Recommended priorities

### P0 — continue now (this branch / immediate)

1. **Football Phase B correct** — period ECE, residual bias, holdout sample; gates stay closed.
2. **Phase C player-prop plan** — settlePaths, joint prop tensor, alt-prop discovery checklist (`PHASE_C_PROP_PLAN.md`).
3. **Coverage matrix v1** — provider → normalize → sim map → settle → qualify → hist → calib → prod (`COVERAGE_MATRIX.md` + `coverageMatrix.ts`).
4. **Closing-line archive design** — schemas + retention + permission notes (`CLOSING_LINE_ARCHIVE.md`); no production ingest until legal/provider OK.

### P1 — start in parallel (separate branches)

| Priority | Work | Why |
|----------|------|-----|
| P1a | **NHL** joint P1–P3 + SOG/points/assists/goals props (+ alts) | Strong V1 prop catalog + period taxonomy already in schemas |
| P1b | **NBA** joint Q/H + points/reb/ast/threes props (+ alts) | Richest alt-prop ladder; high Coach volume |
| P1c | **MLB** joint F5 + hits/HR/K props (+ alts) | Distinct conservation; strong Odds alt keys |

WNBA/NCAAB share basketball **code family** but **separate** param packs, chrono splits, and `sport:family` flags (NBA pass ≠ WNBA enable).

### P2 — parallel after scaffold

- Soccer (goals + BTTS/DNB/DC settlePaths; props only where league posts — often WC-only)
- Tennis (set/game coupling; match totals)
- Combat (method/rounds mutual exclusion)

### P3 — backlog

- tabletennis, cricket, golf outrights
- Boxing app surface (schema reserved)

### Prop-first rule

For every sport with Odds main/alt prop keys **and** ESPN (or equivalent) box-score fields:

1. Design generative player stats **on the same joint draw** as team scoring.
2. Register settlePaths for mains **and** `_alternate` ladders.
3. Add regression: alt props must survive discovery → normalize → grade → ticket assembly (no silent drop).
4. Block family until OOS prop calibration passes — do not ship scoring-only and invent prop probs later.

Sports with thin prop feeds (many soccer leagues, tennis, tabletennis): keep `player_prop` unsupported; score game markets only when validated.

## 3. Branch boundaries (file ownership)

| Path | Owner |
|------|--------|
| `src/models/football/**` | Football stream |
| `src/models/hockey/**` *(new)* | Hockey |
| `src/models/basketball/**` *(new)* | Basketball |
| `src/models/baseball/**` *(new)* | Baseball |
| `src/models/soccer/**` *(new)* | Soccer |
| `src/models/tennis/**` *(new)* | Tennis |
| `src/models/combat/**` *(new)* | Combat |
| `src/archive/**` *(new)* | Closing-line archive |
| `src/coverage/**` or `src/models/coverageMatrix.ts` | Foundation / matrix |
| `src/validation/unsupported.ts` | Coordinated: each sport adds **only its** allowlist entries behind comments; default deny |
| `eval/**` | Sport-specific scripts under `eval/{sport}/` preferred |
| `artifacts/stadium-mobile/**` | **Out of scope** for V2 model PRs |
| Coach / P0 / qualification | **Frozen** |

**Hard rule:** No import of `jointFootball` / `FROZEN_TRAIN_PARAMS` / football gamma shapes into other sports. Shared utilities limited to RNG, settle math, calibration metrics, chrono split helpers.

## 4. Test requirements (every sport stream)

### Unit / contract (CI, required)

| Test | Requirement |
|------|-------------|
| Schema | Sport id + market family parse |
| Conservation | Sport-specific invariants 100% on 10k fixture draws |
| Settle | Main + alt lines from one tensor; odds echoed |
| Unsupported | Unlisted family / missing data → reject |
| Isolation | Default flags → Coach still gets V1 only |
| Alt-prop path | If props in scope: alternate keys not dropped in normalize/settle fixtures |
| No football bleed | Lint/test: other sports do not import football scoring modules |

### Chronological OOS (before any allowlist ask)

- Train / val / **untouched holdout**
- ≥500 settled observations per `sport:family` under gate
- Brier, log loss, ECE (≤0.04), scoring accuracy, market-slice calibration
- Game/event-clustered CIs
- Leak-free features (`kickoff < target`)
- Report committed under `eval/report/` or `eval/{sport}/report/`

### Shadow soak

- Shadow ledger compare vs V1 where V1 exists
- Latency p95 ≤800ms @ deep draws
- Integrity reject rate = 0 on production-shaped fixtures

### Explicitly not required for merge of shadow code

- Allowlist entry
- Coach wiring
- OTA
- Period-spread P0 lift

## 5. Acceptance & flags (unchanged thresholds)

Per `acceptanceGates.ts`: minOosSample 500, maxEce 0.04, integrity 0, deep p95 800ms, no `fixture.*`.

Enable only via explicit `SIM_V2_ACCEPTED_FAMILIES=sport:family` **after** human review. Rollback: `SIM_V2_FORCE_V1`.

## 6. Practical sequencing (calendar-free)

```
[Foundation] coverage matrix + CL archive schemas ─────────────────────────┐
[Football B] scoring correct (this PR) ──► [Football C] props              │
[NHL] scaffold joint + props ──────────────────────────────────────────────┤──► Phase I
[NBA] scaffold joint + props; WNBA/NCAAB param forks ──────────────────────┤   cutover
[MLB] scaffold joint + props ──────────────────────────────────────────────┤   per family
[Soccer] / [Tennis] / [Combat] scaffolds when owners available ────────────┘
```

Integration (Phase I) is **last**: monitoring dashboards, per-family cutover runbooks, still no auto-enable.

## 7. Related docs

| Doc | Purpose |
|-----|---------|
| `ALL_SPORTS_ROADMAP.md` | Architecture + phase names |
| `COVERAGE_MATRIX.md` | Human coverage matrix |
| `src/models/coverageMatrix.ts` | Machine-readable rows |
| `CLOSING_LINE_ARCHIVE.md` | CLV / market-implied design |
| `PHASE_C_PROP_PLAN.md` | NFL/NCAAF prop planning |
| `PHASE_B_CORRECT_REPORT.md` | Football scoring status |
