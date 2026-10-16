# Production OTA prep — Hot Picks / Easy Money navigation

**Status:** Prepared for review — **not published**. `.ota-production-freeze` remains armed.  
**No native build · no merge · no production publish** in this turn.

---

## Exact release SHA

| Role | SHA |
|------|-----|
| **Production OTA release tip** | `c859c1ce73ae64182a996a2751b4f831d601ba8d` |
| Baseline (last production JS tip / Account scroll) | `100b2450c18a74edfc806b6090149b62ad108f96` |
| Source fix (preview-verified Hot Picks OTA JS) | `40f5b9f4747df2b99c98c4c08d26f276e2e07d16` |
| Branch | `cursor/prod-ota-home-shortcuts-8b51` |

Construction: **cherry-pick** of `40f5b9f4` onto `100b2450` (surgical). Does **not** take tip of `cursor/coach-players-only-kb-8b51`.

---

## Included changes (only)

JS-only Home → Coach / Props / Steals shortcut wiring:

| Path | Change |
|------|--------|
| `lib/homeShortcuts.ts` + `.test.ts` | Distinct destinations; Hot Picks / Easy Money → Coach `autoMsg` |
| `lib/coachSilentLaunch.ts` | Queue `autoMsg` so tab param drops cannot kill Home taps |
| `app/(tabs)/index.tsx` | Wire quick actions to `runHomeShortcut` |
| `app/(tabs)/coach.tsx` | Consume launch + auto-send on mount |
| `app/(tabs)/props.tsx`, `steals.tsx` | Sport-preserved destinations for Best Value / Longshots (same commit) |
| `fantasy.tsx`, `SlipBar.tsx`, `TennisHomeFeed.tsx` | Minor call-site alignment |

**No** `package.json`, `app.json`, `eas.json`, iOS/Android native, or Expo plugin changes.

---

## Explicitly excluded (newer unpublished matchup / related work)

Do **not** publish tip of `cursor/coach-players-only-kb-8b51` or anything after `40f5b9f4` on that line:

| Excluded | Why |
|----------|-----|
| `65106875` Best Value `view=value` + Longshots “Across all sports” | Not Hot Picks / Easy Money; unpublished follow-on |
| `42a9ace9`+ opp-context once / matchup tilt | Newer unpublished Coach scoring |
| `7eb04109` / `979bc632` / `8e97e383` paired O/U adjust + UI | Matchup display / simHit work |
| `169c3344` P0 digest + Nix audit docs | Telemetry / audit — needs API if shipped |
| Full tip `81a37106…` consolidated preview package | Preview-review only |

---

## App Store Build 78 compatibility

| Check | Result |
|-------|--------|
| App Store / TF runtime | **`1.1.0`** (matches `app.json` `runtimeVersion`) |
| Production channel runtime | **`1.1.0`** (live `eas channel:view production`) |
| Native dependency delta vs baseline `100b2450` | **None** (cherry-pick is JS-only) |
| Build 78 missing `ClerkExpoPasskeys` | Fail-soft already in baseline (`79d51bef` ≤ `100b2450`; dynamic `getPasskeys()` in `_layout`) |
| New native module / plugin / boot-path change | **No** |
| Native / EAS rebuild required for this tip? | **No** — OTA-eligible JS wiring of existing tabs |

**Policy note:** `ota-release-policy.sh` lists “navigation structure / routing” as native-build triggers. This tip restores **existing** Home quick-action → Coach `autoMsg` consumption (blank-thread bug), already exercised on preview OTA `01a14121…` at runtime `1.1.0`. It does not add routes, deep links, or Expo Router structure. Treat as **JS bugfix**, not a new navigation architecture.

### Device verification status (honest)

| Shortcut | Preview OTA `01a14121` @ `40f5b9f4` | Unit tests @ release tip |
|----------|--------------------------------------|---------------------------|
| Hot Picks | **PASS** (nav + auto-send + terminal ticket) | PASS |
| Easy Money | **Unverified on device** (same Coach silent-launch path as Hot Picks) | PASS (shared `home_shortcuts` / `coachSilentLaunch`) |
| Best Value / Longshots | Longshots PASS on same OTA; Best Value value-view is **excluded** (`65106875`) | Destinations covered in `40f5b9f4` tests |

---

## Live production channel (prep time)

| Field | Value |
|-------|--------|
| Channel | `production` → branch `production` |
| Current tip | **Emergency rollback to embedded** — group `4a0960e4-10e8-4ac8-a77d-3c37891942c2` |
| Prior JS tip (pre-crash) | group `b76dd8f2-…` — Account scroll @ `100b2450` / update `01a13a0a-…` |
| Freeze | `.ota-production-freeze` **armed** (scripts refuse publish) |

---

## Freeze release steps (before any publish)

Do **not** run publish until every gate below is satisfied.

### A. Freeze lift prerequisites (from `.ota-production-freeze` + TestFlight steps)

1. Recover device `expo-error.log` / Updates native log with **first Fatal** for Build 78 IPS (still open — see `docs/build78-ips-crash-diagnosis.md`).
2. Root cause understood **or** intentional stay on embedded documented.
3. Re-attest Build 78 / `1.1.0` binary: cold launch ×2, Home, Coach, auth — **no ErrorRecovery loop**.
4. Write `.ota-testflight-verified` only after real device attestation (`scripts/TESTFLIGHT_VERIFICATION_STEPS.md` Step 4).
5. **Remove** `.ota-production-freeze` on the ref Actions will check out (typically `main`) — only with owner approval.
6. Confirm gates: `bash artifacts/stadium-mobile/scripts/verify-ota-production-freeze-gates.sh` then expect publish scripts to proceed only when freeze file is gone.

### B. Pre-publish validation (this tip)

```bash
git fetch origin cursor/prod-ota-home-shortcuts-8b51
git checkout cursor/prod-ota-home-shortcuts-8b51
git rev-parse HEAD   # must be c859c1ce73ae64182a996a2751b4f831d601ba8d (or documented successor docs-only)

# Scope guard — must NOT contain matchup / footballRushDefense adjust tip
git merge-base --is-ancestor 42a9ace9 HEAD && echo FAIL_has_matchup || echo OK_no_matchup
git diff --name-only 100b2450..HEAD | grep -E 'package.json|app.json|ios/|Podfile' && echo FAIL_native || echo OK_js_only

cd artifacts/stadium-mobile
node --import ./test/register-hooks.mjs --test lib/homeShortcuts.test.ts
# expect 4/4 pass

bash scripts/verify-ota-production-freeze-gates.sh   # while freeze armed: publish still blocked
EXPO_TOKEN=… bash scripts/pre-publish-ota-check.sh     # read-only channel/build facts
EXPO_TOKEN=… bash scripts/diagnose-production-ota.sh
```

### C. Publish sequence (owner-approved only — not run now)

1. Confirm checkout SHA = **`c859c1ce73ae64182a996a2751b4f831d601ba8d`**.
2. Confirm freeze lifted + `.ota-testflight-verified` present.
3. `EXPO_TOKEN=… bash scripts/publish-production-ota.sh "fix(home): Hot Picks / Easy Money nav c859c1ce"`
   - Targets `runtimeVersion=1.1.0`, channel `production`.
   - Default path rolls back to embedded then publishes fresh bundle (`ROLLBACK_EMBEDDED=1`).
4. `eas channel:view production` — new group, runtime `1.1.0`, message contains release SHA.
5. Device (App Store / TF Build 78, runtime 1.1.0): cold launch ×2; Home → **Hot Picks**; Home → **Easy Money**; confirm Coach auto-send; no ErrorRecovery SIGABRT.
6. Keep emergency embedded rollback available: `rollback-production-ota` (ungated by freeze design).

### D. Still do not

- Publish tip of matchup / opp-context branch
- Merge this prep into `main` unless owner requests
- Run native EAS build for this JS-only tip
- Treat Telegram / Build 78 fatal attribution as closed without log paste

---

## Tests run this prep

| Suite | Result |
|-------|--------|
| `homeShortcuts.test.ts` @ `c859c1ce` | **4/4 pass** |
| Freeze gate audit | **PASSED** (freeze armed; publish scripts gated) |

Artifacts: `/opt/cursor/artifacts/home-shortcuts-cherry-pick.log`, `production-channel-view-prep.log`
