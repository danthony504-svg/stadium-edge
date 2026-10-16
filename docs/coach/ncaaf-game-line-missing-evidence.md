# NCAAF team-market (spread / ML / totals) — missing validation evidence

**Tip under audit:** `cursor/coach-college-8leg-audit-8b51` @ `e6f36c63` (and any tip that still matches the engine/gate state below).  
**Status:** **Do not restore.** `NCAAF_GAME_LINE_SIM_VALIDATED` must stay `false`.  
**Planning parent:** [`ncaaf-game-line-recovery-plan.md`](./ncaaf-game-line-recovery-plan.md).  
**Phase E work lineage (not on this tip):** `origin/cursor/odds-api-access-5cb3` and football-unit port commits (`4738df08` → `1f9cc04a` → `014ec192` / `12e355af`). Merge-base with tip ≈ `100b2450` — Phase E SHAs are **not** ancestors of this tip.

---

## 1. What the engine still lacks TODAY on this branch tip

Compared to what the football-unit pack (`1f9cc04a`, engine stamp `ppg-per-drive-v1`) and soft-rate fix (`4738df08`) claimed elsewhere:

| Capability claimed off-tip | On this tip (`e6f36c63`) |
|----------------------------|--------------------------|
| Soft-monotonic TD/FG rates past former knee (~11.8 / ~11.2 ppd) via `footballDriveMatchup` | **Absent.** `nflDriveSim.ts` still hard-caps at `NFL_DRIVE_TD_RATE_CAP = 0.42` / `NFL_DRIVE_FG_RATE_CAP = 0.28`; further ppd increases are NOOP (`nflDriveRatesSaturated`) |
| Defense yards-allowed tilt (±8%, `sampleSize ≥ 2`) | **Absent.** `runNflDriveSim` uses only `ptsFor` / `ptsAgainst` via `teamMean`; tip test `nflDriveSimCaps.test.ts` asserts rush/pass defense never enters inputs |
| PPG → shared drive count → points-per-drive (`FOOTBALL_DRIVE_ENGINE_VERSION = "ppg-per-drive-v1"`) | **Absent.** Tip still feeds game means into the per-drive rate map (the unit mismatch Phase E later withdrew as a PASS claim) |
| College-specific drive scale / late-clock / rate input path | **Absent.** Tip uses NFL defaults (`driveScale 55`, late-clock TD `0.08`, default mean `22`) for both sports |
| `ncaafGameLineSimValidation.test.ts` (E1 sensitivity ≥2pp) | **Absent** from tip tree |
| Phase E holdout harness + fixtures + checklist | **Absent** (see §2) |
| Gate | `NCAAF_GAME_LINE_SIM_VALIDATED = false` in `artifacts/stadium-mobile/lib/coachP0UnvalidatedTotals.ts` — correctly armed |

Tip recovery plan still lists the live problems (hard caps, no defense/injury in distribution, sparse splits, exact-line binding) as open Phase A–C work. Totals (FG / team / period) remain on a **separate** P0 even if sides were ever cleared.

**Forbidden:** flipping `NCAAF_GAME_LINE_SIM_VALIDATED` solely so Coach returns NCAAF spread/ML/totals picks. The flag is a validation seal, not a product unlock.

---

## 2. Completed Phase E evidence produced elsewhere vs NOT on this tip

All artifacts below are readable via `git show <sha>:<path>`. None of these paths exist on tip `HEAD`.

### Engine / unit work (off tip)

| SHA | What it produced | On tip? |
|-----|------------------|---------|
| `4738df08` | Soft rates + defense tilt; `footballDriveMatchup.ts`; `ncaafGameLineSimValidation.test.ts`; **kept P0 armed** | **No** |
| `1f9cc04a` | Football-unit pack: `ppg-per-drive-v1`, stamp/seal, holdout script updates, dual calibration path | **No** |

### Holdout / CLV / checklist (off tip; primarily `origin/cursor/odds-api-access-5cb3`)

| SHA | Artifact / claim | On tip? |
|-----|------------------|---------|
| `8266280b` | First `ncaafPhaseEHoldoutCalibration.ts` + stub report + checklist | **No** |
| `20b140ee` | Venue-aware holdout clears E2a home-win bias (L10-only FAIL → venue blend). Report @ 1500 sims: Brier **0.199**, ECE **0.042**, bias ≈ **+0.020**, dog +7.5 cover **0.669** (n=133). Verdict `E2_outcomeVsCoin=PASS` but `E2_closingLineClv=INSUFFICIENT_DATA`, `flagFlipAllowed=false` | **No** — and that E2a PASS was later **WITHDRAWN** on football-unit lineage (ppg-fed-as-ppd + ×0.48 college scale) |
| `e928a8ca` | `ncaafPhaseEHoldoutLeakage.test.ts` (form kickoff &lt; evaluated game) + P0 telemetry | **No** |
| `d036cc5a` | Historical Odds API SUCCESS samples + injury gap documented | **No** |
| `7fbf065a` | E2b closing archive builder + `ncaaf-phase-e-closing-lines.{json,csv}` + e2b report; soft gates coded (`n≥200`, market/engine Brier &lt; 0.25, \|mean(engine−market)\| ≤ **0.15**). Early report mislabeled soft gates as `E2b_engineClv=PASS` — later docs correct this | **No** |
| `218109d0` | Separates soft gates from true CLV; `ncaaf-phase-e-true-clv-*` (home-blanket study — **not** Coach pick CLV) | **No** |
| `a2f59a9c` / `12e355af` | Coach pick CLV @ 10k sims: **182** picks (107H/75A), mean ML CLV **−0.0234**, % beat close **20.9%**, hit **0.497** (Wilson 0.425–0.570), verdict **`COMPUTED_NO_PASS_LABEL`**. Checklist + `ncaafPhaseEGates.test.ts` aligned | **No** |
| `014ec192` | Dual holdout pin: `ncaaf-phase-e-calibration-report-tip-ppg-v1.json` (engine `nfl-drive:ppg-per-drive-v1`, 10k sims, seed **20241015**: Brier **0.19860**, ECE **0.05296**, bias ≈ **+0.037**, dog cover **0.6757** n=111) and legacy pre-ppg report; both `keepP0Armed=true`, `flagFlipAllowed=false`, E4 **INSUFFICIENT_DATA**, E2b CLV **OPEN_NEEDS_AGREED_TOLERANCE** | **No** |

### Explicitly NOT completed even on Phase E branches

- **E4 injury conservatism** — always `INSUFFICIENT_DATA` (no pre-kickoff `injuryKnown` / `qbOut` join; missing must not coerce to `false`).
- **E2b CLV PASS** — soft gates ≠ CLV; Coach pick CLV has **no PASS label**; no agreed CLV tolerance recorded as PASS.
- **E6 human sign-off** — always `OPEN`.
- **`flagFlipAllowed`** — always `false`; scripts exit **2** while restore blocked.

---

## 3. Exact missing evidence checklist (measurable)

To validate NCAAF **game-side** markets on **this tip’s engine** (or after porting a candidate engine), all of the following must exist **on the commit that would flip the flag**:

### Engine prerequisites (Phase A–C vs tip)

- [ ] Soft (or otherwise non-flat) TD/FG rate map: unit proof that ppd above ~11.8 still moves rates (`footballDriveScoringRates` monotonicity or equivalent).
- [ ] Controlled sensitivity: **+3 ppg** and **QB-out (−6 ptsFor) proxies** each move ML/spread cover by **≥ 0.02** (2 percentage points) when not data-starved — same bar as `ncaafGameLineSimValidation.test.ts` / recovery plan A2 & Phase E #1.
- [ ] Defense tilt only when `sampleSize ≥ 2`; fail closed (no invented packs); clamp documented (plan: ±8% vs median).
- [ ] Sparse venue splits (`games < 2`) fall back / blend with L10; provenance logged.
- [ ] Exact-line binder: graded spreads bind posted `point` + same-row sportsbook price **100%**; unposted alts stay ungraded.
- [ ] Holdout form leakage test green (every form contributor available before evaluated kickoff).

### E2a — outcome calibration (frozen OOS window)

Coded thresholds from Phase E reports/scripts (`minGames`, `eceMax`, `biasMaxAbs`, `dog75CoverMaxWhenMlNearHalf`):

- [ ] Holdout games scored **≥ 200** (Phase E used **865** scored / 6 thin-skip on 2024 ESPN fixture).
- [ ] Engine Brier **&lt; 0.25** (beat coin).
- [ ] ECE (10-bin) **≤ 0.12**.
- [ ] \|meanP − meanY\| (home ML) **≤ 0.08**.
- [ ] Near-coin-flip home ML (pHome in **(0.45, 0.55)**) away **+7.5** cover rate **≤ 0.70** with **n ≥ 30** (official cohort; multi-seed range documented).
- [ ] Report generated against the **same engine stamp** that would ship (do not reuse WITHDRAWN pre-ppg / ×0.48 PASS).

### E2b — closing lines + CLV (not soft gates alone)

Soft gates (necessary, **not sufficient** for restore / not a CLV PASS):

- [ ] Frozen pre-kickoff close archive (`date=kickoff`, snap **&lt;** commence) with **n ≥ 200** joined games.
- [ ] `marketBrier(close ML) < 0.25`.
- [ ] `engineBrier < 0.25` on the **same** games.
- [ ] \|mean(engineP_home − marketP_home_at_close)\| **≤ 0.15**.

CLV / selection evidence still required:

- [ ] Agreed CLV acceptance rule documented **and** measured (soft Δp is **not** CLV).
- [ ] Coach pick CLV @ **10 000** sims/game attached; mixed home/away; verdict reviewed by human (existing off-tip run was **`COMPUTED_NO_PASS_LABEL`** — mean ML CLV **−0.0234**, hit **0.497** — and must not be cited as PASS without new accept criteria).

### E4 — injury conservatism

- [ ] Pre-kickoff-timestamped `injuryKnown` (true\|null) + optional `qbOut`; **null ≠ false**.
- [ ] mean \|edge\| on injury-unknown **≤** mean \|edge\| on injury-known; n documented for both segments.

### E5 / E6 / scope / E2E

- [ ] E5: `coachP0UnvalidatedTotals` + college mix + NFL/NHL totals P0 regressions green on the flag-flip commit.
- [ ] E6: named human approver + UTC date + commit SHA in a **flag-only** PR (template in off-tip `ncaaf-e6-signoff-evidence.md` @ `12e355af`).
- [ ] Totals FG/team/period remain on separate P0 until totals recalibration — this flag clears **game-side** NCAAF lines only.
- [ ] E2E: device/build returns valid simulated NCAAF spread/ML picks (not P0 early-exit empty notes alone).

### Tip tree gaps (must be present before claiming “validated on tip”)

- [ ] `artifacts/api-server/scripts/ncaafPhaseEHoldoutCalibration.ts`
- [ ] `artifacts/api-server/test/fixtures/ncaaf-phase-e-calibration-report.json` (and close/CLV fixtures as needed)
- [ ] `docs/coach/ncaaf-phase-e-checklist.md` (+ E4/E6 docs)
- [ ] `artifacts/api-server/test/ncaafPhaseEGates.test.ts`
- [ ] `artifacts/api-server/test/ncaafGameLineSimValidation.test.ts`
- [ ] Soft-rate / matchup engine modules if that is the candidate under test

---

## 4. Acceptance criteria to flip `NCAAF_GAME_LINE_SIM_VALIDATED`

**Do not flip now.** Tip fails engine prerequisites and has zero Phase E artifacts.

Flip only in a **single PR that only changes the flag** (and docs recording sign-off), when **all** are true on that commit:

1. **E2a PASS** — Brier &lt; coin, ECE ≤ **0.12**, \|bias\| ≤ **0.08**, near-coin +7.5 dog cover ≤ **0.70** (n≥30), on a frozen holdout for the shipping engine.
2. **E2b soft gates PASS** — close archive wired; market/engine Brier &lt; coin; \|mean(engine−market)\| ≤ **0.15** — and separately a **human-accepted** Coach pick CLV / agreed CLV result (soft gates alone never authorize the flip).
3. **E4 PASS** — unknown injury segment does not show higher mean \|edge\| than known; `injuryKnown` null when unknown.
4. **E5 green** on that commit.
5. **E6** — named approver + date + SHA in the PR body.
6. Totals P0 unchanged.
7. **E2E** proof of real simulated NCAAF sides (not empty P0 path).

Off-tip Phase E’s own latest reports still say: `keepP0Armed: true`, `flagFlipAllowed: false`, `E2_readyForRestore: OPEN_NEEDS_VALIDATION_INJURY_SIGNOFF`, `NCAAF_GAME_LINE_SIM_VALIDATED: "false — do not flip"`.

---

## 5. Enabling the gate just to return picks is forbidden

`NCAAF_GAME_LINE_SIM_VALIDATED` may be set `true` **only** after the acceptance criteria in §4 pass with human Phase E sign-off.

It is **forbidden** to flip the constant (or bypass `isP0UnvalidatedNcaafGameLineMarket` / `ncaafGameLineAskIsP0Blocked`) merely to populate Coach tickets with NCAAF spreads, moneylines, or game totals. An empty / blocked college game-line ask under P0 is the correct product behavior until validation lands.

---

## Citation index (absolute repo paths / SHAs)

| Item | Location |
|------|----------|
| Tip recovery plan | `docs/coach/ncaaf-game-line-recovery-plan.md` |
| Tip gate (false) | `artifacts/stadium-mobile/lib/coachP0UnvalidatedTotals.ts` |
| Tip hard-cap engine | `artifacts/api-server/src/lib/sportSim/nflDriveSim.ts` |
| Tip cap tests | `artifacts/api-server/test/nflDriveSimCaps.test.ts` |
| Soft rates + defense | `git show 4738df08:artifacts/api-server/src/lib/sportSim/…` |
| Football-unit pack | `1f9cc04a` |
| Phase E checklist (final CLV wording) | `git show 12e355af:docs/coach/ncaaf-phase-e-checklist.md` |
| Holdout script | `git show 014ec192:artifacts/api-server/scripts/ncaafPhaseEHoldoutCalibration.ts` |
| Calibration reports | `git show 014ec192:artifacts/api-server/test/fixtures/ncaaf-phase-e-calibration-report*.json` |
| Coach pick CLV report | `git show 12e355af:artifacts/api-server/test/fixtures/ncaaf-phase-e-coach-pick-clv-report.json` |
| E6 pack | `git show 12e355af:docs/coach/ncaaf-e6-signoff-evidence.md` |
