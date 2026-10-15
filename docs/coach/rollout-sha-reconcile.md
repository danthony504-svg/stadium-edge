# Rollout SHA reconcile (PR #736 / Build78 fixpack + football-unit port)

**Reviewed tip (this branch HEAD after football-unit port):** run `git rev-parse HEAD` on `cursor/football-unit-port-def8`.

Functional baseline before the port: `013ddb88` (null-note fix + isolated pipeline/cancel).  
Football-unit pack source: PR **#738** tip `e3b4dc81` (`cursor/nfl-spread-ml-scoring-hang-b9b4`).

## 1. SHA relationship

| SHA | Role |
|-----|------|
| `057c9f0d…` | **Installed preview-build78 IPA** baseline (EAS `9155c37b`, runtime `1.1.0`, channel `preview`, no `ClerkExpoPasskeys`) |
| `4738df08` | Soft drive rates / defense tilt precursor (not yet `ppg-per-drive-v1`) |
| `e6c8bb60` | Docs tip (EXPO_TOKEN). Ancestor of fixpack tip |
| `576578cd` / `013ddb88` | Fixpack tip before football-unit port |
| `e3b4dc81` | PR #738 — named football-unit pack (ppg-v1, stamp, seal, parse, null-note, deadline) |
| **this port tip** | `013ddb88` lineage **+** football-unit files/tests from `e3b4dc81` |

`e6c8bb60` ⊂ `576578cd` ⊂ `013ddb88`. The six named football-unit features were **not** on that tip until this port ([Find football-unit fix SHAs](bc-2990b9c4-2a1e-5e29-9f1c-e5bd784da511)).

## 2. Retention checklist (after port)

| Protection | Marker | Status |
|------------|--------|--------|
| **ppg-per-drive-v1** | `FOOTBALL_DRIVE_ENGINE_VERSION = "ppg-per-drive-v1"` | **Retained** — `footballDriveUnit.test.ts` PASS |
| **engine-stamp rejection** | `gameDrawEngineAccepted` / `simEngineStamp` | **Retained** — unstamped/mismatched draws not graded |
| **period sealing/blocking** | `sealPublishedClientPeriodQueries` / `sealCachedGameSim` | **Retained** — `gameOutcomePayload.test.ts` PASS |
| **request parsing** | `asksFullGameSidesOnly` + `fullGameOnly` in ask filter | **Retained** |
| **null-note handling** | `joinCoachNoteParts` | **Retained** — skips null fragments |
| **unified deadline** | `coachRequestDeadlineMs` ≡ `coachAbsoluteBudgetMs` ≡ live terminal | **Retained** — session tests PASS |

`NCAAF_GAME_LINE_SIM_VALIDATED = false` — **P0 remains armed**.

## 3. meanP / meanY: ~0.674/0.637 vs 0.495/0.608

Per [Trace meanP/meanY sources](bc-c5a5f9fd-e13a-53aa-9ed1-f7de0e9f81b2): the “old” pair is documented as **0.657 / 0.637** (not exact 0.674). **Same Phase E harness / engine**, **different form methodology**:

| | L10-only (checklist was citing) | Venue-aware / ppg-v1 (PR #738) |
|--|--------------------------------|--------------------------------|
| **meanP / meanY** | **0.494 / 0.608** | **0.657 / 0.637** (bias PASS) |
| **Engine** | `runNflDriveSim` | Same + `ppg-per-drive-v1` stamp |
| **Form inputs** | Combined L10 only | **venue_split + L10** (`blendVenueAndL10`) |
| **n scored** | 796 (75 thin skipped) | 865 (6 thin skipped) |
| **nSims** | 1500 | 1500 (later seeded 10k reports on #738) |
| **Seed** | Unseeded `Math.random` | Unseeded in first venue report; later seeded holdouts on #738 |
| **Commit / artifact** | `8266280b` L10-only report | `20b140ee` venue-aware report; current checklist on #738 cites ppg-v1 PASS |

**Verdict:** **Not a same-methodology regression** — L10-only vs venue-aware form. Current ported checklist tracks the venue / `ppg-per-drive-v1` holdout. Restore still **NO** (E2b/E4/E6 open; flag false).

## 4. Isolated Coach pipeline + cancellation

Pre-port evidence on `013ddb88`: `artifacts/api-server/test/fixtures/coach-pipeline-cancel-isolated.json`

| Track | Result |
|-------|--------|
| Full pipeline `5 leg` | **PASS** (after null-note fix) |
| College under P0 | **PASS** honest shortfall |
| Cancellation | **PASS** |
| Physical-device React UI | **PENDING** |

Re-run isolated harness after merge if desired; unit retention for the six markers is green on this port tip.

## 5. Freeze / non-goals

- Production freeze armed
- No merge to main, deploy, OTA, native build, or device registration in this turn
- Expo-token injection not required for these results
