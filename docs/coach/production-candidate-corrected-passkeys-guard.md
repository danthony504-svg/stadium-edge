# Corrected production candidate — contents report (**not published**)

**Freeze:** `.ota-production-freeze` **armed** — no production OTA, no native build, no server deploy, no merge required for this prep.  
**Known-bad:** group `af92adaa…` / tip `c859c1ce` remains known-bad.  
**Oct 14:** not attributed to missing-`ClerkExpoPasskeys` without its own fatal log.

---

## Why the prior production tip shape failed

Prior release tip `c859c1ce` = cherry-pick of shortcuts onto `100b2450` **without** `hasClerkExpoPasskeysNative`. On Build 78/79–class binaries (module absent), cold start hits:

`_layout` → `getPasskeys()` → `require("@clerk/expo/passkeys")` → fatal (see [`failed-c859c1ce-clerk-passkeys-fatal-evidence.md`](./failed-c859c1ce-clerk-passkeys-fatal-evidence.md)).

---

## Candidate composition (exact)

**Working-tree tip on branch `cursor/prod-ota-home-shortcuts-8b51` after this prep** = failed tip ancestry **plus** restored working-tip guards from `40f5b9f4`:

### A. Home shortcut surface (unchanged from `c859c1ce` / `40f5b9f4` identical files)

| Path | Role |
|------|------|
| `artifacts/stadium-mobile/lib/homeShortcuts.ts` | Hot Picks / Easy Money / etc. destinations |
| `artifacts/stadium-mobile/lib/coachSilentLaunch.ts` | Coach silent launch queue |
| `artifacts/stadium-mobile/app/(tabs)/index.tsx` | Home wiring |
| `artifacts/stadium-mobile/app/(tabs)/coach.tsx` | Auto-send consume |
| `artifacts/stadium-mobile/app/(tabs)/fantasy.tsx` | Shortcut destinations |
| `artifacts/stadium-mobile/app/(tabs)/props.tsx` | Shortcut destinations |
| `artifacts/stadium-mobile/app/(tabs)/steals.tsx` | Shortcut destinations |
| `artifacts/stadium-mobile/components/SlipBar.tsx` | Related UI |
| `artifacts/stadium-mobile/components/TennisHomeFeed.tsx` | Related UI |
| (+ matching `homeShortcuts` test if present) | |

### B. Native-availability guard (**required** — restored from `40f5b9f4`)

| Path | Role |
|------|------|
| `artifacts/stadium-mobile/lib/passkeyAuth.ts` | `hasClerkExpoPasskeysNative()` + fail-closed before `require("@clerk/expo/passkeys")` |
| `artifacts/stadium-mobile/lib/passkeyAuth.test.ts` | Guard unit tests |
| `artifacts/stadium-mobile/lib/passkeyStartupGuard.test.ts` | **New** regression: `_layout` passkeys prop with module absent |

### C. OTA apply / embedded-rollback hardenings (restored from `40f5b9f4` / `afcf638d`)

| Path | Role |
|------|------|
| `artifacts/stadium-mobile/lib/ota/OtaController.ts` | Embedded rollback / safer reload gating |
| `artifacts/stadium-mobile/lib/ota/createExpoOtaClient.ts` | Client reload helpers |
| `artifacts/stadium-mobile/lib/ota/types.ts` / `index.ts` | Types + exports |
| `artifacts/stadium-mobile/lib/otaLaunch.ts` | Skip reload when already on target |
| `artifacts/stadium-mobile/components/OtaUpdateBanner.tsx` | Banner copy / identity |
| (+ matching `*.test.ts`) | |

### D. Unchanged entry shell

| Path | Note |
|------|------|
| `artifacts/stadium-mobile/app/_layout.tsx` | Still calls `getPasskeys()` for `ClerkProvider`; safe **only** because B is present |

---

## Diff vs failed tip `c859c1ce` (candidate delta)

Only the guard + OTA hardening files above (section B + C + new startup test). Shortcut files **byte-identical** to `c859c1ce` and to `40f5b9f4`.

## Diff vs PASS tip `40f5b9f4`

Candidate is **not** a full tree match to `40f5b9f4` (that tip also carries 48 commits of coach/sim/docs). For production Hot Picks / Easy Money on Build 78, the **minimum crash-class fix** is B; C is retained from the demonstrated working tip’s apply path.

## Validation (pre-publish)

| Check | Result |
|-------|--------|
| `node --test lib/passkeyAuth.test.ts lib/passkeyStartupGuard.test.ts` | See `/opt/cursor/artifacts/passkey-startup-guard-tests.log` |
| Production freeze armed | Yes |
| This candidate published? | **No** |

## Explicitly not done

- Production / preview publish of this corrected tip  
- Native / EAS rebuild  
- Freeze lift  
- Claiming Oct 14 fatal === this string  
