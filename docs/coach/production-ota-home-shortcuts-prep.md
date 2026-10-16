# Production OTA prep — Hot Picks / Easy Money navigation

**Status:** Prepared + preview-channel validation published — **production not published**.  
**`.ota-production-freeze` remains armed** on this branch and on `main`.

---

## Exact release SHA

| Role | SHA |
|------|-----|
| **Production OTA JS release tip** | `c859c1ce73ae64182a996a2751b4f831d601ba8d` |
| Baseline (last production JS tip / Account scroll) | `100b2450c18a74edfc806b6090149b62ad108f96` |
| Source fix (preview device tip) | `40f5b9f4747df2b99c98c4c08d26f276e2e07d16` |
| Branch | `cursor/prod-ota-home-shortcuts-8b51` |

Construction: **cherry-pick** of `40f5b9f4` onto `100b2450`. Excludes matchup / opp-context / `65106875` Best Value follow-on.

---

## Verification record (corrected 2026-10-16)

| Surface | Result |
|---------|--------|
| Preview OTA `01a14121` @ `40f5b9f4` — **Hot Picks** | **PASS** |
| Preview OTA `01a14121` @ `40f5b9f4` — **Easy Money** | **PASS** (owner correction; earlier docs wrongly said Unverified) |
| Preview OTA `01a14121` — Longshots | **PASS** |
| **App Store Build 78 + release `c859c1ce…`** (cold launch ×N, Hot Picks, Easy Money, no ErrorRecovery loop) | **UNVERIFIED** |

Matching `runtimeVersion=1.1.0` and unchanged native dependencies are **compatibility checks only**. They do **not** prove crash-free launch on Build 78.

---

## Baseline `100b2450` on actual Build 78 — cold-launch evidence?

| Question | Answer |
|----------|--------|
| Is there a recorded **cold-launch PASS** of tip `01a13a0a` / commit `100b2450` on App Store Build 78? | **No** |
| What exists instead? | Freeze + IPS investigation: Build 78 / 1.1.0 died in Expo **ErrorRecovery SIGABRT** after production tip `01a13a0a…` (publish #619 @ `100b2450`). Fatal string / running `updateId` **not proven**. Channel later **rolled back to embedded** (`4a0960e4…`). |
| Does that establish crash-free launch for the baseline? | **No** — opposite of a cold-launch attestation |

Sources: `.ota-production-freeze`, `docs/build78-ips-crash-diagnosis.md`, `docs/coach/build78-crash-vs-today-ota.md`.

---

## Controlled-channel validation of exact release bundle (this turn)

**Goal:** put `c859c1ce` on a non-production channel without moving public production.

| Step | Result |
|------|--------|
| Publish exact tip to **`preview`** channel | **Done** — group `af92adaa-9a40-44ab-b13a-dfd6d8315061`, iOS update `01a142e1-23e0-772e-beb5-bf03df51e982`, runtime `1.1.0`, message embeds `c859c1ce` |
| Production channel after publish | **Unchanged** — still emergency embedded rollback `4a0960e4-10e8-4ac8-a77d-3c37891942c2` |
| Freeze | **Armed** (`.ota-production-freeze` restored on this branch) |

### Why this is not yet a Build 78 device PASS

| Binary | Channel baked in | Sees preview OTA `01a142e1…`? |
|--------|------------------|-------------------------------|
| **App Store Build 78** | `production` | **No** — only production OTAs |
| **`preview-build78` IPA** (EAS `9155c37b`, no ClerkExpoPasskeys, channel `preview`) | `preview` | **Yes** — correct controlled stand-in |

Device cold-launch ×N / Hot Picks / Easy Money / ErrorRecovery checks on **`preview-build78` + update `01a142e1…`** (or App Store Build 78 via production, which is frozen) were **not executable in this Cloud Agent** (Linux VM; no Xcode/Simulator/iPhone). Status remains **UNVERIFIED** pending human device on `preview-build78`.

**Human device checklist (preview-build78 only):**

1. Install / open IPA `9155c37b` (runtime `1.1.0`, channel `preview`).
2. Force-quit → cold launch ×3; confirm update `01a142e1…` / tip `c859c1ce`.
3. Home → Hot Picks; Home → Easy Money; Coach auto-send.
4. Confirm **no** ErrorRecovery boot loop / SIGABRT.
5. Record results into a new `docs/coach/device-check-ota-01a142e1-*.md`.

---

## Compatibility checks (not crash-free proof)

| Check | Result | Means |
|-------|--------|-------|
| `runtimeVersion` 1.1.0 matches Build 78 | Yes | OTA **eligible** for that binary family |
| Native deps unchanged vs `100b2450` | Yes | No new native module contract |
| Passkey fail-soft in baseline | Yes | Missing `ClerkExpoPasskeys` guarded in JS |
| Crash-free cold launch on Build 78 | **UNVERIFIED** | Requires device attestation |

---

## Freeze steps: script-enforced vs checklist

### Script / workflow enforced (hard fail)

| Gate | Mechanism |
|------|-----------|
| Block production publish / force / heal / republish / bootstrap / ota-test-001/002 / prepare-force-update-103 | `scripts/lib/require-ota-unfrozen.sh` sourced by those scripts; exits if `.ota-production-freeze` present |
| Same block in CI | `.github/workflows/{publish,force,heal,republish,bootstrap,ota-test-001,ota-test-002}-*.yml` fail-fast if freeze file present after checkout |
| Require `.ota-testflight-verified` before some local freeze-lift helpers | `scripts/check-ota-production-freeze.sh` exits if marker missing (also exits if freeze present) |
| Gate audit | `scripts/verify-ota-production-freeze-gates.sh` asserts scripts/workflows contain freeze checks; rollback must stay **ungated** |
| Preview publish allowed while freeze armed | `publish-preview-ota.sh` (on later tips) notes freeze; does **not** source `require-ota-unfrozen` |

**Not blocked by freeze:** `rollback-production-ota` (embedded only) — by design.

### Checklist only (not auto-enforced by scripts)

| Step | Where written |
|------|----------------|
| Recover Build 78 `expo-error.log` / first Fatal | `.ota-production-freeze` “Lift only after”, `docs/build78-ips-crash-diagnosis.md` |
| Root cause understood or intentional embedded stay | freeze file lift criteria |
| Human cold-launch ×2 on Build 78 / TF before lift | freeze file; `TESTFLIGHT_VERIFICATION_STEPS.md` |
| Creating `.ota-testflight-verified` only after real device work | `TESTFLIGHT_VERIFICATION_STEPS.md` (scripts check **presence**, not authenticity) |
| Owner removes `.ota-production-freeze` from `main` | Ops checklist |
| Device PASS of Hot Picks / Easy Money on Build 78 with `c859c1ce` | This prep doc / device-check docs |
| Prefer `preview-build78` stand-in before touching production | `docs/device-test-fixpack-736.md` |

---

## Excluded unpublished work

Matchup / opp-context (`42a9ace9`+), paired simHit UI (`7eb04109`+), Best Value `view=value` (`65106875`), consolidated preview tip — **not** in this release SHA.

---

## Tests / artifacts this turn

| Item | Result |
|------|--------|
| `homeShortcuts.test.ts` @ `c859c1ce` | **4/4 pass** (prior) |
| Preview OTA publish of `c859c1ce` | **Published** — `01a142e1-23e0-772e-beb5-bf03df51e982` |
| Production channel | **Unchanged** (embedded rollback) |
| Build 78 / `preview-build78` device cold-launch of `c859c1ce` | **UNVERIFIED** (no iOS device in agent env) |

Artifacts: `/opt/cursor/artifacts/preview-ota-c859c1ce.log`, `production-channel-after-preview-c859.log`, `preview-channel-after-c859.log`
