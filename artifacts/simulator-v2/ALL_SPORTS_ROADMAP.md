# Simulator V2 — All-Sports Architecture & Roadmap

**Status:** Planning approved for parallel development + NFL/NCAAF Phase B correct in progress.  
**Production:** V2 shadow-only. All sport:family acceptance lists empty. Coach / P0 / PR #649 unchanged.  
**Do not merge, deploy, or OTA from this document alone.**  
**Parallel plan:** [`PARALLEL_DEVELOPMENT_PLAN.md`](./PARALLEL_DEVELOPMENT_PLAN.md) — sport streams do **not** wait on football calibration.

## 1. Goal

Simulator V2 must eventually cover **every Stadium Edge sport** with sport-specific joint models, validated settlement mappings, 10k-draw baselines where feasible, chronological OOS calibration, and **independent** `sport:family` feature flags. One sport passing never enables another.

## 2. Stadium Edge sport inventory vs V2

| App sport (`ODDS_SPORT_KEYS`) | V2 schema id | V1 game sim today | V1 prop sim today | V2 generative model | Priority phase |
|------------------------------|--------------|-------------------|-------------------|---------------------|----------------|
| nfl | `nfl` | Yes (FG + period frac/OD) | Yes | **Phase B correct** (shadow) | B / C |
| ncaaf | `ncaaf` | Yes | Limited / team-leaning | **Phase B correct** (shadow) | B / C |
| nhl | `nhl` | Yes (FG + P1–P3 frac) | Yes | None | D |
| nba | `nba` | Yes (FG + Q/H frac) | Yes | None | E |
| wnba | `wnba` | Yes | Yes | None | E |
| ncaab | `ncaab` | Yes (halves; limited period books) | Limited | None | E |
| mlb | `mlb` | Yes (FG + F5/I1) | Yes | None | F |
| soccer | `soccer` | Yes (FG; period unsupported in simMarketSupport) | Limited | None | G |
| tennis | `tennis` | Name-only fight-style | N/A / match games | None | G |
| ufc / mma | `ufc` / `mma` | Name-only fight sim | Fight stats / rounds | None | H |
| boxing | `boxing` *(add)* | Not first-class today | — | None | H |
| tabletennis | `tabletennis` *(add)* | Name-only ML fallback | — | None | G′ / backlog |
| cricket | `cricket` *(add)* | Odds keys only; thin ESPN | — | None | backlog |
| golf | `golf` | Outrights only (not game MC) | Outrights | None | backlog |

Sources: `api-server/src/lib/sports.ts`, `stadium-mobile/lib/simMarketSupport.ts`, `@workspace/simulator-v2` schemas + `models/football/*`.

## 3. Architecture (all sports)

```
Provider odds + ESPN/roster/injury/lineup feeds
        │
        ▼
 SportAdapter (per sport)
   • event identity, home/away orientation
   • period taxonomy (Q/H/P/F5/sets/rounds)
   • feature builders (leak-free pre-start only)
        │
        ▼
 JointScenarioGenerator (sport-specific)
   • 10_000 draws default (SIM_V2_DEEP_DRAWS)
   • exact conservation invariants per sport
   • player participation + stat tensors when props enabled
        │
        ▼
 SettlementRegistry
   • provider market key → settlePath + comparator + period
   • unsupported → fail closed (no invented probs)
        │
        ▼
 settle / batchAlts ──► ShadowLedger + CalibrationStore
        │
        ▼
 selectProductionSimResult(flags, sport, family)
   • default: V1 only
   • serve iff master ∧ ¬shadowOnly ∧ serve ∧ sport:family accepted
```

### Hard invariants (every sport)

1. **Joint consistency** — related period/player outcomes from one draw set; conservation rules sport-specific (e.g. football Q-sum=FG; hockey P-sum=FG regulation; baseball F5 ⊆ FG).
2. **Fail closed** — missing data, unknown family, unvalidated model id → `unsupported` / `missing_data` / `integrity_reject`.
3. **Odds preservation** — American odds echoed; never synthesized as “fair” replacements.
4. **Independent gates** — `SIM_V2_ACCEPTED_FAMILIES` entries are `sport:family` keys only.
5. **Coach isolation** — qualification, correlation, 48h window, prop caps, no-filler rules stay outside V2; V2 only supplies `simHit` when explicitly accepted.
6. **Alt props** — candidate discovery → normalize → grade → ticket assembly must not drop alt player props that have valid settle mappings (Phase C+ checklist).
7. **Telemetry** — per sport:family: draw count actually used, latency, ECE/Brier/log-loss, integrity reject rate, markets simulated vs skipped.

### Sport-specific generative families

| Family | Sports | Core state | Conservation / coupling |
|--------|--------|------------|-------------------------|
| Football joint | NFL, NCAAF | Q1–Q4 points | Q-sum=FG; H1/H2 derived |
| Basketball joint | NBA, WNBA, NCAAB | Q1–Q4 (NCAAB: halves) | Q/H-sum=FG |
| Hockey joint | NHL | P1–P3 goals (+ OT/SO layer) | P-sum=regulation; OT separate |
| Baseball joint | MLB | Inning runs / F5 | F5 ≤ FG; pitcher–batter props coupled |
| Soccer joint | Soccer leagues | Goals + BTTS/DNB/DC | 90' + optional ET; cards/corners optional later |
| Tennis joint | ATP/WTA | Sets/games | Set winners ⇒ match; games total coupled |
| Combat joint | UFC/MMA/Boxing | Method, round, winner | Method mutually exclusive; rounds consistent with method |
| Golf outrights | Golf | Field finish | Rank uniqueness; not game-line MC |

Player props always attach to the **same** joint tensor (participation flags + stat draws), never independent FG overwrite.

## 4. Coverage gaps (current)

| Gap | Detail |
|-----|--------|
| Non-football generators | Only `football.joint.phase_b_correct` / v0 exist |
| Props in V2 | `player_prop` family schema exists; **no** sport registers it for settle |
| Soccer specials | V1 grades BTTS/DNB/DC as fullGame; V2 needs explicit families or settlePaths |
| Boxing | Not in app sport keys; treat as combat sibling under Phase H |
| tabletennis / cricket | In Odds path; thin sim; schema to be extended, models backlog |
| Closing-line archive | Historical calibration lacks market-implied baselines (ESPN post-game odds empty) |
| Period models outside football | V1 still uses independent frac/OD-style decomposition — known consistency risk |
| Acceptance allowlist | Empty for all sports (correct) |

## 5. Acceptance gates (per sport:family)

Existing thresholds in `acceptanceGates.ts` (do not loosen):

| Gate | Threshold |
|------|-----------|
| OOS sample | ≥ 500 settled observations |
| ECE | ≤ 0.04 |
| Integrity reject rate | 0 |
| Correct reject-label rate | ≥ 0.99 |
| Deep p95 latency | ≤ 800 ms @ 10k draws |
| Forbidden model ids | `fixture.*` |
| Shadow soak | Required complete |
| Contract tests | Green |

**Additional all-sports requirements before any allowlist entry:**

1. Chronological train / val / **untouched holdout** report committed.
2. Game-clustered (or event-clustered) CIs on holdout ECE/Brier.
3. Joint consistency tests green for that sport’s period/player invariants.
4. Explicit market coverage matrix: simulated vs blocked vs insufficient data.
5. Alt-line + alt-prop discovery regression tests (no silent drops).
6. Manual review: P0 blocks for that market family only lifted after gate pass + separate approval.

Flags remain: `SIM_V2_ENABLED`, `SIM_V2_SHADOW_ONLY`, `SIM_V2_SERVE`, `SIM_V2_ACCEPTED_FAMILIES`, `SIM_V2_FORCE_V1`.

## 6. Phased labels (parallel streams)

Phase letters are **labels**, not a global queue. NHL/NBA/MLB/etc. may start on independent branches while B/C continue.

| Phase | Scope | Stream | Exit criteria (shadow) |
|-------|--------|--------|-------------------------|
| **B** *(current)* | NFL/NCAAF scoring + periods | Football | Holdout path; conservation 100%; gates closed |
| **C** | NFL/NCAAF player props (+ alts) | Football | `nfl:player_prop` / `ncaaf:player_prop` separate gates |
| **D** | NHL joint + props | Hockey | Own generative model; no football reuse |
| **E** | NBA/WNBA/NCAAB + props | Basketball | Separate param packs + flags per sport |
| **F** | MLB + props | Baseball | F5 conservation; starter features |
| **G** | Soccer / Tennis | Soccer + Tennis | Specials / set-game coupling |
| **H** | UFC/MMA/Boxing | Combat | Method×rounds exclusion |
| **I** | Integration / monitoring / cutover | Foundation | Per-family allowlist only |

### Dependencies (parallel)

```
Phase A foundation (shared) ──┬──► Football B ──► Football C (props)
                              ├──► Hockey D (scoring+props)     [parallel]
                              ├──► Basketball E (+ prop-first)  [parallel]
                              ├──► Baseball F (+ prop-first)    [parallel]
                              ├──► Soccer/Tennis G              [parallel]
                              ├──► Combat H                     [parallel]
                              ├──► Coverage matrix + CL archive design
                              └──► Phase I cutover (last, per family)

Hard rule: no football scoring distributions / FROZEN_TRAIN_PARAMS reused outside football.
Prop-first: where Odds mains+alts + box-score maps exist, props are in-scope with scoring.
Coach/P0/PR#649/OTA ── unchanged.
```

## 7. Near-term priorities

1. Continue **Phase B correct** + **Phase C planning** (this football stream).
2. Stand up **parallel branches** for NHL, basketball, MLB (see parallel plan).
3. Maintain **coverage matrix** (`COVERAGE_MATRIX.md` / `coverageMatrix.ts`).
4. Land **closing-line archive design** (`CLOSING_LINE_ARCHIVE.md`) — ingest off until license OK.
5. Never flip serve/allowlist without independent holdout + human approval.

## 8. What we will not do

- Enable unvalidated V2 models or widen `ACCEPTED_FAMILIES` without holdout evidence.
- Invent probabilities for unsupported markets.
- Reuse football scoring code as another sport’s generative model.
- Modify PR #649, Coach qualification/correlation/48h/no-filler, or remove P0 blocks as part of V2 work.
- Merge / deploy / publish OTA from roadmap or Phase B correct without separate review.
- Auto-enable one sport because another passed.
- Wait for football calibration before starting other sport scaffolds.

## 9. Related docs

| Doc | Role |
|-----|------|
| `PARALLEL_DEVELOPMENT_PLAN.md` | Branches, tests, priorities |
| `COVERAGE_MATRIX.md` | Provider→prod dimensions |
| `src/models/coverageMatrix.ts` | Machine-readable matrix |
| `CLOSING_LINE_ARCHIVE.md` | Market-implied / CLV design |
| `PHASE_C_PROP_PLAN.md` | NFL/NCAAF props plan |
| `PHASE_B_CORRECT_REPORT.md` | Football scoring status |
| `src/models/sportRegistry.ts` | Sport inventory registry |
