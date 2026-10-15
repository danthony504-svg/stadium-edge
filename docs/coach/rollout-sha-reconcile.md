# Rollout SHA reconcile (PR #736 / Build78 fixpack + football-unit port)

**Reviewed tip (exact):** `30eafeb8c8b8e51fc7a9e796c75b25e2377a026f`

Functional baseline before the port: `013ddb88` (null-note fix + isolated pipeline/cancel).  
Football-unit pack source: PR **#738** tip `e3b4dc81` (`cursor/nfl-spread-ml-scoring-hang-b9b4`).  
Corrected drive-unit measurement docs: `2c13a3ba` (ppg→ppd; college ×0.48 retired from live path).

## 1. SHA relationship

| SHA | Role |
|-----|------|
| `057c9f0d…` | **Installed preview-build78 IPA** baseline (EAS `9155c37b`, runtime `1.1.0`, channel `preview`, no `ClerkExpoPasskeys`) |
| `4738df08` | Soft drive rates / defense tilt precursor (not yet `ppg-per-drive-v1`) |
| `e6c8bb60` | Docs tip (EXPO_TOKEN). Ancestor of fixpack tip |
| `576578cd` / `013ddb88` | Fixpack tip before football-unit port — **still applies NCAAF ×0.48 and feeds PPG as PPD** |
| `6f18926b` → `2c13a3ba` | Corrected ppg→ppd conversion; ×0.48 retired from live path; 10k holdout docs |
| `e3b4dc81` | PR #738 — named football-unit pack (ppg-v1, stamp, seal, parse, null-note, deadline, seeded calib) |
| **`30eafeb8` (this tip)** | `013ddb88` lineage **+** football-unit pack **+** null-note trim fix **+** period partial seal **+** 8-leg broncos regression **+** calib module |

## 2. Engine proof: `013ddb88` vs `2c13a3ba` (label alone insufficient)

Artifact: `artifacts/api-server/test/fixtures/drive-engine-commit-compare.json`

| Check | `013ddb88` | `2c13a3ba` / tip |
|-------|------------|------------------|
| `FOOTBALL_DRIVE_ENGINE_VERSION = "ppg-per-drive-v1"` | **absent** | present |
| Live caller | `footballDriveRateInput(homeOff, sport)` | `footballExpectedDrives` then `footballDriveRateInput(ppg − late, drives, sport)` |
| Conversion | feeds **PPG** (college ×**0.48**) into per-drive map | **`ppg / drives`**; scale constant exported but **not multiplied** |
| NCAAF 28/24 example rate fed to map | home **13.44** (=28×0.48) | home **≈2.545** (=28/11) |

Dual fixed-seed 10k holdout (primary seed `20241015`, identical fixtures + `blendVenueAndL10` walk): `dual-commit-holdout-compare.json`

| | Tip `ppg-per-drive-v1` | Legacy `013ddb88` |
|--|----------------------|-------------------|
| meanP / meanY | **0.6740 / 0.6370** | **0.6570 / 0.6370** |
| Brier | 0.19860 | 0.19853 |
| Dog cover (0.45–0.55) | **0.6757** (n=111) | **0.6934** (n=137) |
| Live smoke | `ppg/drives` | NCAAF 28 → rate **13.44** (=×0.48); proj ~42+ |

Δ meanP (tip − legacy) ≈ **+0.017**. Same seed/fixtures; difference is the conversion path.

## 3. Retention checklist

| Protection | Marker | Status |
|------------|--------|--------|
| **ppg-per-drive-v1** | `FOOTBALL_DRIVE_ENGINE_VERSION` + `ppg/drives` caller | **Retained** — unit + compare proof |
| **engine-stamp rejection** | `gameDrawEngineAccepted` / `simEngineStamp` | **Retained** |
| **period sealing/blocking** | seal + `unvalidated_period_full_game_decomposition` + partial `revalidateDeliveryPicks` | **Retained / tightened** |
| **request parsing** | `asksFullGameSidesOnly` + `fullGameOnly` | **Retained** |
| **null-note handling** | `joinCoachNoteParts` (no `.trim()` on null `built.note`) | **Retained / fixed** |
| **unified deadline** | `coachRequestDeadlineMs` ≡ absolute ≡ live terminal | **Retained** |

`NCAAF_GAME_LINE_SIM_VALIDATED = false` — **P0 remains armed**. Unsupported period markets stay blocked.

## 4. Device ask regressions (isolated full pipeline)

Artifact: `artifacts/api-server/test/fixtures/coach-pipeline-cancel-isolated.json`  
Client tip: `30eafeb8`. Isolated sim: tip SHA. Production healthz (unchanged): `cf6c0f69`.

| Ask | Runtime | Legs | Period in partial/final | Null-note | Notes |
|-----|---------|------|-------------------------|-----------|-------|
| **8 leg broncos** | ~5.6s | 7 (honest shortfall) | **none** | **safe** | Matchup scope = entire SEA@DEN game (Seahawks sides/props allowed; other NFL games excluded) |
| **4 leg NFL spreads and moneylines for upcoming games.** | ~7.2s | 1 (honest shortfall) | **none** | **safe** | `fullGameOnly`; delivered FG Alt Spread only |
| Cancel `8 leg broncos` @ 2.5s | ~2.5s | aborted | — | — | **PASS** cleanup |

Physical-device React UI: **PENDING**. Publication: **pending review** (no OTA / native / prod).

## 5. Server-first / preview-OTA readiness

| Item | Status |
|------|--------|
| IPA baseline | `057c9f0d` / EAS `9155c37b` / runtime `1.1.0` / channel `preview` |
| Tip vs IPA natives | Compatible → **JS/OTA + server-first** (no new native build) |
| Production freeze | **armed** |
| NCAAF / unsupported periods | **blocked** |
| Rollout | **Ready for preview-OTA review only** — not production publish |

## 6. Freeze / non-goals

- No merge to main, deploy, production OTA, native build, or device registration in this turn
- Publication stays pending review
