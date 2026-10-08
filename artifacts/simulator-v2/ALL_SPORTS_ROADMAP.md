# Simulator V2 — All-Sports Architecture & Roadmap

**Status:** Planning + NFL/NCAAF Phase B correct in progress.  
**Production:** V2 shadow-only. All sport:family acceptance lists empty. Coach / P0 / PR #649 unchanged.  
**Do not merge, deploy, or OTA from this document alone.**

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

## 6. Phased rollout

| Phase | Scope | Exit criteria (shadow) |
|-------|--------|-------------------------|
| **B** *(current)* | NFL/NCAAF scoring + period markets (ML/spread/total/team_total) | Holdout ECE path; conservation 100%; gates still closed |
| **C** | NFL/NCAAF **player props** (joint with game tensor); alt props path audit | Prop families gated separately (`nfl:player_prop`, …) |
| **D** | NHL joint P1–P3 + FG; team markets; then props | `nhl:*` gates independent |
| **E** | NBA / WNBA / NCAAB joint quarters/halves; then props | College vs pro params separate |
| **F** | MLB joint innings/F5 + pitcher/batter props | F5 conservation + starter confirmation features |
| **G** | Soccer (multi-league) + Tennis | Soccer specials mapped; tennis set/game coupling |
| **H** | UFC / MMA / Boxing combat joint | Method/rounds mutual exclusion tests |
| **I** | All-sports integration, monitoring dashboards, controlled cutover | Per-family allowlist only; rollback via `SIM_V2_FORCE_V1` |

### Dependencies

```
Phase A platform (schemas, settle, flags, shadow) ──┐
                                                   ├──► B football scoring
B holdout + audit ─────────────────────────────────┼──► C football props
                                                   │
C joint prop tensor patterns ──────────────────────┼──► D/E/F prop phases
B conservation + chrono OOS harness ────────────────┼──► D/E/F/G scoring phases
Closing-line archive (external) ───────────────────┴──► stronger market baselines (all phases)
Coach/P0 protections ── unchanged throughout ── cutover only in I per family
```

## 7. Implementation order (near term)

1. **Finish Phase B correct** — period ECE, residual bias, larger NFL holdout sample; keep serve off.
2. **Sport registry + coverage reporter** — machine-readable matrix (`sportRegistry.ts`); CI prints blocked families.
3. **Schema align** — add `boxing`, `tabletennis`, `cricket` ids; keep unsupported.
4. **Phase C design** — football prop settlePaths, participation, alt-prop discovery tests.
5. **Phase D NHL** — three-period joint goals model (no football code reuse for scoring).
6. Only after each phase’s holdout gates: optional allowlist entry + separate review (still no OTA without approval).

## 8. What we will not do

- Enable unvalidated V2 models or widen `ACCEPTED_FAMILIES` without holdout evidence.
- Invent probabilities for unsupported markets.
- Modify PR #649, Coach qualification/correlation/48h, or remove P0 blocks as part of V2 work.
- Merge / deploy / publish OTA from roadmap or Phase B correct without separate review.
- Auto-enable WNBA because NBA passed (or any cross-sport inheritance).

## 9. Related docs

| Doc | Role |
|-----|------|
| `PHASE_B_CORRECT_REPORT.md` | NFL/NCAAF generative correction + holdout |
| `eval/report/CHRONOLOGICAL_OOS.md` | Chrono OOS numbers |
| `eval/report/CALIBRATION_ROOT_CAUSE_AUDIT.md` | Pre-correction audit |
| `src/models/sportRegistry.ts` | Machine-readable coverage matrix |
