# Rollout SHA reconcile (PR #736 / Build78 fixpack)

**Reviewed SHA (exact):** `576578cd22ac69108e8a7a74177b9de75f708d39` plus follow-up null-note hardening commit on this branch — use `git rev-parse HEAD` on `cursor/build78-fixpack-def8` as the single install/review tip after merge of this reconcile.

After this reconcile lands, the **single reviewed tip** is the branch HEAD (see “Pinned tip” below). Do not treat `e6c8bb60` alone as the install SHA.

## 1. SHA relationship

| SHA | Role |
|-----|------|
| `057c9f0d…` | **Installed preview-build78 IPA** baseline (EAS `9155c37b`, runtime `1.1.0`, channel `preview`, no `ClerkExpoPasskeys`) |
| `4738df08` | Football-unit college sim: soft ppd rates, defense tilt, college scale; P0 stays armed |
| `e6c8bb60` | Docs tip (EXPO_TOKEN saved-vs-injection). Ancestor of HEAD. Strip tooling had drifted vs IPA |
| `576578cd` | Restores IPA-matching strip/`associatedDomains` omit; records installed binary. **Superset of `e6c8bb60`** (`e6c8bb60` + 1 commit) |
| This reconcile HEAD | `576578cd` + null-note crash fix + isolated pipeline/cancel evidence |

**Football-unit lineage on tip:** previously tested college/drive work enters via `4738df08` (ancestor of `e6c8bb60` / `576578cd`). Side-rank / underdog commits (`c954be30`, `8448b29d`) sit between `4738df08` and `e6c8bb60`.

## 2. Retention checklist (present on reviewed tip)

| Protection | Marker | Status |
|------------|--------|--------|
| **ppg-per-drive-v1** | `footballDriveScoringRates` / `FOOTBALL_DRIVE_*_PPD_DIVISOR` (ppd÷28 / ÷40 soft map) in `footballDriveMatchup.ts` | **Retained** — `nflDriveSimCaps` + `ncaafGameLineSimValidation` PASS |
| **engine-stamp rejection** | `assessSimMarketIntegrity` / `sanitizeSimHitForGrade` → `[coach-sim-integrity]` reject | **Retained** — rejects unvalidated period/team totals (`unvalidated_period_or_team_total_calibration`) |
| **period sealing/blocking** | P0 period markets + `fillReservedPeriodSlots` NCAAF period block + post-lean period block | **Retained** — `coachP0UnvalidatedTotals` + `postLeanFinalFill` / board-scan period tests |
| **request parsing** | `parseCoachAskMarketConstraint` | **Retained** — Coach QA / ask-filter suites |
| **null-note handling** | `sanitizeCoachUserNote(null)` + `buildParlay` null-safe note join | **Retained + fixed** — tip crashed on `built.note.trim()` when `note === null`; now `(built.note ?? "").trim()` |
| **unified deadline** | `coachAbsoluteBudgetMs` (5→75s, 6→90s, …) | **Retained** — `coach/session.test.ts` PASS |

`NCAAF_GAME_LINE_SIM_VALIDATED = false` — **P0 remains armed**.

## 3. meanP / meanY: 0.674/0.637 vs 0.495/0.608

| | ~0.674 / ~0.637 | 0.495 / 0.608 (canonical E2a) |
|--|-----------------|--------------------------------|
| **Engine** | Not reproducible as a checked-in E2a report on this branch | Coach `nfl-drive` via `ncaafPhaseEHoldoutCalibration.ts` |
| **Dataset** | meanY≈0.637 matches **raw 2024 population** home-win rate in `ncaaf-phase-e-games.json` (871 decisive games → **0.638**) | **Form-filtered 2024 holdout** only (need ≥2 L10 samples): **n=796**, skip thin=75 → meanY **0.608** |
| **Inputs** | Unknown / not archived | L10 ptsFor/ptsAgainst walk-forward; college rate scale **0.48**; soft TD/FG knees; **no** defense packs in holdout script |
| **Seed** | Unknown | `Math.random` (no fixed seed); sims/game **1500** in fixture report |
| **Commit / artifact** | **No git artifact** with meanP≈0.674 paired to meanY≈0.637 | Commit **`8266280b`** wrote `artifacts/api-server/test/fixtures/ncaaf-phase-e-calibration-report.json` (generatedAt 2026-10-14) |

**Verdict:** **Different test / Y-universe**, not a same-harness regression.

- Re-running E2a on tip still yields meanP≈0.49, meanY=0.608 (bias FAIL) — college scale off (NFL path) yields meanP≈0.44, **not** 0.674.
- The ~0.637 figure is the **unfiltered 2024 base rate**; E2a’s 0.608 is the **scored subset**. Treat 0.495/0.608 as the only authoritative Phase E number on this SHA. Keep restore **blocked**.

## 4. Isolated Coach pipeline + cancellation

Isolated tip-SHA sim server: `artifacts/api-server/scripts/isolatedCoachSimServer.mjs` (no `DATABASE_URL`; mounts simulate* from this checkout).  
Harness: `artifacts/stadium-mobile/scripts/isolatedCoachPipelineCancel.ts` (rewrites `/sports/simulate*` → local; odds/board from Render).

Evidence: `artifacts/api-server/test/fixtures/coach-pipeline-cancel-isolated.json`

| Track | Result |
|-------|--------|
| Full pipeline `5 leg` | **PASS** terminal (5 legs) after null-note fix |
| College `6 leg college` | **PASS** terminal; 0 legs + P0/shortfall copy (expected while flag false) |
| Cancellation (abort @2.5s) | **PASS** (`abortedSignal=true`, runtime≈2.5s) |
| Physical-device React UI | **PENDING** (explicit) |

Production deploy SHA at test time (`/api/healthz`): `cf6c0f69…` — **does not** include `4738df08` college sim; tip engine exercised only via isolated sim rewrite.

## 5. Freeze / non-goals

- Production freeze armed (`.ota-production-freeze`)
- No merge, deploy, OTA, native build, or device registration in this reconcile
- Expo-token injection not required for these code/test results
