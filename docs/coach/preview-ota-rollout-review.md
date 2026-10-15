# Preview-OTA rollout review pack (do not execute)

**Functional tip SHA (tested):** `ddeb4733348b98d7112748edc19c7e06fc6fc99a`  
**Branch tip (docs/artifacts):** resolve with `git rev-parse origin/cursor/football-unit-port-def8`  
**PR:** https://github.com/danthony504-svg/stadium-edge/pull/739

This document prepares review only. It does **not** publish OTA, deploy production, merge, or start a native build.

---

## 1. Corrected tip SHA used for these tests

| Role | Full SHA |
|------|----------|
| **Functional / pipeline / engine tip** | `ddeb4733348b98d7112748edc19c7e06fc6fc99a` |
| Isolated sim health during final pipeline | `ddeb4733348b98d7112748edc19c7e06fc6fc99a` |
| Artifact | `artifacts/api-server/test/fixtures/coach-pipeline-cancel-isolated.json` (`generatedAt` 2026-10-15T15:21:51.059Z) |

Code at that tip includes: `ppg-per-drive-v1` + `ppg/drives` conversion, null-note `joinCoachNoteParts`, period partial revalidate, 8-leg broncos regression, footballCalibration port.

---

## 2. Exact server-first / preview-OTA deployment scope

**In scope (when review approves — not now):**

| Step | Target | Channel / surface | SHA |
|------|--------|-------------------|-----|
| A. Server-first | Staging/API deploy of tip | API `POST /sports/simulate/game-outcome` + slate stamps | `ddeb4733…` |
| B. Preview OTA | JS bundle only onto **existing** IPA | Expo channel **`preview` only** | same tip |
| C. Device | Installed **preview-build78** IPA | No new EAS native build | IPA `057c9f0d…` / EAS `9155c37b-0297-45a7-98fe-ea3f38bea6a9` / runtime `1.1.0` |

**Out of scope / frozen:**

- Production OTA (`.ota-production-freeze` armed)
- Production Render deploy / merge to `main`
- New native IPA / EAS `preview-build78` rebuild (natives match tip)
- Flipping `NCAAF_GAME_LINE_SIM_VALIDATED`
- Unblocking unsupported period markets

**Order (from `football-drive-unit-rollout.md`):** server stamps first → then preview client that rejects missing/wrong stamp. NCAAF game lines and unsupported periods stay fail-closed on the client through both steps.

---

## 3. Seven SEA@DEN legs — markets + correlation / exposure proof

Source ticket: isolated pipeline ask **`8 leg broncos`** (7 legs delivered; honest shortfall vs 8).

| # | Market | Pick | Prop? | Period | Ladder key |
|---|--------|------|-------|--------|------------|
| 1 | Alt Spread | Seahawks +1.5 | no | fg | `…\|spread\|seahawks` |
| 2 | Rec Yds | Jaxon Smith-Njigba Over 92.5 | yes | fg | distinct player+stat+side |
| 3 | Receptions | Tory Horton Over 0.5 | yes | fg | distinct |
| 4 | Rush Yds | George Holani Over 13.5 | yes | fg | distinct |
| 5 | Pass TDs | Sam Darnold Over 1.5 | yes | fg | distinct |
| 6 | Longest Reception | Rashid Shaheed Over 14.5 | yes | fg | distinct |
| 7 | Receptions | Emanuel Wilson Under 1.5 | yes | fg | distinct (different player + side) |

**Same-game / single-event mode:** ask activates `team_game_scope` single-event seating. Caps for target ≥ 8: **`maxProps: 6`**, **`maxGameEventLines: 4`** (`SINGLE_EVENT_CAPS[8]`).

| Check | Limit | Actual | Result |
|-------|-------|--------|--------|
| Prop exposure | ≤ 6 | 6 | **PASS** |
| Game-line exposure | ≤ 4 | 1 | **PASS** |
| Duplicate market ladder | all distinct | 7 unique keys | **PASS** |
| Duplicate player prop | one prop family per player | 6 distinct players | **PASS** |
| Unsupported period | 0 | 0 | **PASS** |
| Matchup scope | Broncos game only | all SEA@DEN | **PASS** |

Artifact: `artifacts/api-server/test/fixtures/sea-den-7leg-correlation-proof.json`.

Multi-game default `maxPropsPerGame(8)=2` does **not** apply here — team nickname asks use the raised single-event ceilings above. Soft same-game correlation still requires distinct ladders and players (proven).

---

## 4. Client + server contain corrected `ppg / drives`

| Surface | Marker at `ddeb4733` | Status |
|---------|----------------------|--------|
| Server | `FOOTBALL_DRIVE_ENGINE_VERSION = "ppg-per-drive-v1"`; `footballDriveRateInput` → `return ppg / n`; caller `footballExpectedDrives` then rate | **Present** |
| Server | `FOOTBALL_COLLEGE_RATE_INPUT_SCALE` not multiplied on live path | **Absent from path** |
| Client | `COACH_GAME_SIM_ENGINE_VERSION = "ppg-per-drive-v1"`; stamp reject before cache/grade | **Present** |
| Client | `NCAAF_GAME_LINE_SIM_VALIDATED = false` | **Blocked** |
| Client | Period delivery: `unvalidated_period_full_game_decomposition` + partial `revalidateDeliveryPicks` | **Blocked** |

Smoke: NCAAF 28 PPG / 11 drives → **2.545** PPD (not 13.44 = ×0.48).

---

## 5. Device checks after rollout (when approved — not now)

Use **existing** IPA `9155c37b` / commit `057c9f0d`. Production OTA stays frozen. After **preview** OTA of `ddeb4733…`:

1. **Running update ID** — Settings / Expo updates: confirm the published preview update id matches the tip publish (record id in the review note). Cold-launch twice so the update applies.
2. **Exact ask A:** `8 leg broncos` — no `trim` exception; no Q3/period legs in partial or final; ticket confined to Broncos matchup; note may show honest shortfall.
3. **Exact ask B:** `4 leg NFL spreads and moneylines for upcoming games.` — `fullGameOnly`; no props/totals/periods; shortfall copy if underfilled.
4. **Cancellation** — start ask A, cancel within ~2–3s; composer unlocks; no stuck loading; no orphan cards.
5. **Loading cleanup** — after terminal ticket or cancel, status/spinner clears; no “scoring…” latch.
6. **Cold relaunch** — force-quit, reopen, confirm update id still tip; re-run ask A once for smoke.

Physical React UI remains **PENDING** until those steps run on device.

---

## 6. Review gate (no execution)

- [ ] Human review of PR #739 + this pack
- [ ] Approve server-first staging deploy of `ddeb4733…` (not production)
- [ ] Approve preview-channel OTA only (not production)
- [ ] Keep `.ota-production-freeze` armed
- [ ] Keep existing IPA; no native rebuild unless natives diverge

**Do not execute deploy/OTA until explicitly approved.**
