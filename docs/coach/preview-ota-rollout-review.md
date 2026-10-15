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

### Deploy API ≠ production OTA (freeze resolution)

| Surface | What it is | Freeze status |
|---------|------------|---------------|
| **API deploy** | Redeploy Render service **`stadium-edge`** → `https://stadium-edge.onrender.com` (sole API; preview + production IPAs both use `EXPO_PUBLIC_DOMAIN=stadium-edge.onrender.com`) | **Not** blocked by `.ota-production-freeze`. Hook: `RENDER_DEPLOY_HOOK` / workflow `deploy-api-server.yml`. Live healthz today: `deploymentSha=cf6c0f699e6f3dd573ade95514af79b05c8a54c1`. |
| **Production OTA** | Expo `eas update` on channel **`production`** | **Frozen** (`.ota-production-freeze` armed). Scripts refuse production publish. |
| **Preview OTA** | Expo `eas update` on channel **`preview`** via `publish-preview-ota.sh` | Allowed when approved; freeze file only notes production is untouched. |

**Honesty:** one Render service serves all clients. An approved API redeploy of `ddeb4733…` changes `/sports/simulate/game-outcome` for production IPA users too (old clients ignore `engineVersion` but receive corrected `ppg-per-drive-v1` draws). That is intentional server-first order — it is **not** a production Expo OTA and does **not** lift the freeze.

**In scope (when review approves — not now):**

| Step | Target | Channel / surface | SHA |
|------|--------|-------------------|-----|
| A. Server-first | Render **`stadium-edge`** (`stadium-edge.onrender.com`) at functional tip | API `POST /sports/simulate/game-outcome` + slate stamps | `ddeb4733348b98d7112748edc19c7e06fc6fc99a` |
| B. Preview OTA | JS bundle only onto **existing** IPA | Expo channel **`preview` only** | same tip (checkout that SHA so `EXPO_PUBLIC_GIT_COMMIT` matches) |
| C. Device | Installed **preview-build78** IPA | No new EAS native build | IPA `057c9f0ddd42e9309146cc6eb8d3b68f089b4e82` / EAS `9155c37b-0297-45a7-98fe-ea3f38bea6a9` / runtime `1.1.0` |

**Out of scope / frozen:**

- Production OTA (`.ota-production-freeze` armed)
- Merge-to-`main` auto-deploy unless explicitly approved as the API vehicle (prefer deploy-specific-commit / hook aimed at tip)
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

**Same-game / single-event mode:** ask activates `team_game_scope` → `seatSingleEventTicket`. Caps for target ≥ 8: **`maxProps: 6`**, **`maxGameEventLines: 4`** (`SINGLE_EVENT_CAPS[8]`).

| Check | Limit | Actual | Result |
|-------|-------|--------|--------|
| Prop exposure | ≤ 6 | 6 | **PASS** |
| Game-line exposure | ≤ 4 | 1 | **PASS** |
| Duplicate market ladder | all distinct | 7 unique keys | **PASS** |
| Duplicate player prop | one prop family per player | 6 distinct players | **PASS** |
| Unsupported period | 0 | 0 | **PASS** |
| Matchup scope | Broncos game only | all SEA@DEN | **PASS** |

### Pass TDs + receivers + Seahawks spread (actual correlation)

Seating path **`seatSingleEventTicket` does not call `parlayCorrelationPenalty`**. Enforced rules are caps + distinct ladders/players only.

| Pair | Soft penalty (`parlayCorrelationPenalty`, multi-game reference) | Hard reject? |
|------|------------------------------------------------------------------|--------------|
| Darnold Over 1.5 Pass TDs ↔ each receiver prop (JSN / Horton / Shaheed / Wilson) | **+5** each (same-game different-player prop) | **No** |
| Darnold Pass TDs ↔ Seahawks +1.5 | **+7** (prop ↔ game-side) | **No** |
| Darnold vs full ticket without self | **+32** (= 5×5 + 7) | **No** — ranking demotion only |
| Wilson Receptions ↔ Horton Receptions | **+15** (same market +10 + same-game +5) | **No** (different players/ladders) |

| Combined probability | Dependence model |
|----------------------|------------------|
| Independent leg probs only | **None** — no Pass-TD↔receiver joint / copula / sim co-hit adjustment |

Multi-game default `maxPropsPerGame(8)=2` would hard-block from the 3rd prop; it does **not** apply under single-event caps. Distinct players/ladders + count caps alone do **not** account for Pass-TD↔receiver dependence.

Artifact: `artifacts/api-server/test/fixtures/sea-den-7leg-correlation-proof.json` (`honestyGate: PASS_WITH_LIMITATION`).

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

## 6. Preview export + tests pin the same functional SHA

| Artifact / surface | Pinned SHA |
|--------------------|------------|
| `coach-pipeline-cancel-isolated.json` `reviewedSha` | `ddeb4733348b98d7112748edc19c7e06fc6fc99a` |
| `sea-den-7leg-correlation-proof.json` `tipSha` | `ddeb4733348b98d7112748edc19c7e06fc6fc99a` |
| Isolated sim health during pipeline | same tip |
| `publish-preview-ota.sh` | bakes `EXPO_PUBLIC_GIT_COMMIT=$(git rev-parse HEAD)` — **must run on checkout of that tip** |
| Render healthz after API step | expect `deploymentSha` = same tip |

Branch tip may sit atop docs/fixture commits (`24ddd8da…` at review time); runtime code identity for Coach/engine is the functional tip above. Publish/deploy from the tip SHA, not an unrelated main commit.

## 7. Concrete approval-only rollout (do not execute)

1. **API (server-first):** Redeploy Render service **`stadium-edge`** (`https://stadium-edge.onrender.com`) at `ddeb4733348b98d7112748edc19c7e06fc6fc99a` via deploy-hook / dashboard deploy-specific-commit. Confirm `GET /api/healthz` → `deploymentSha` matches. NCAAF game lines + unsupported periods stay client-blocked.
2. **Preview OTA:** On that same checkout, `EXPO_TOKEN=… bash artifacts/stadium-mobile/scripts/publish-preview-ota.sh 'ppg-per-drive-v1 ddeb4733 preview'`. Channel **`preview` only**. Existing IPA `9155c37b` / `057c9f0d…` / runtime `1.1.0`.
3. **Device checks** (section 5). Production OTA stays frozen. No new IPA. No `NCAAF_GAME_LINE_SIM_VALIDATED` flip.

## 8. Review gate (no execution)

- [ ] Human review of PR #739 + this pack
- [ ] Approve Render **`stadium-edge`** API redeploy of `ddeb4733…` (shared API; not Expo production OTA)
- [ ] Approve preview-channel OTA only (not production)
- [ ] Keep `.ota-production-freeze` armed
- [ ] Keep existing IPA; no native rebuild unless natives diverge
- [ ] Acknowledge Pass-TD↔receiver stack is soft/caps-only (no dependence-adjusted combined prob)

**Do not execute deploy/OTA until explicitly approved.**
