# TestFlight verification Steps 1–4 (required before production OTA)

Source of truth: `scripts/verify-stable-release.sh` + `scripts/check-ota-production-freeze.sh`.  
**Do not forge** `.ota-testflight-verified`. Create it only after real device work below.

Current App Store / production binary targets **`runtimeVersion` 1.1.0** (`app.json`).  
Native builds are **not** authorized in the current release window unless the owner explicitly approves a new EAS build. If a verified 1.1.0 TestFlight/App Store binary already exists, Steps 1–3 may be **re-attested** on that binary; Step 4’s 24h smoke is still required before writing the marker.

---

## Step 1 — iOS development build (OTA off)

- [ ] `eas build --profile development --platform ios` (only if a new binary is needed)
- [ ] Install on a **physical iPhone**
- [ ] App opens without red error / ErrorBoundary
- [ ] Home, Coach, Props, +500 Steals open
- [ ] Authentication works (email sign-in / session persists)
- [ ] Navigation stable (tabs, menu, back)
- [ ] Stays open ≥ 1 minute; cold launch ×2

## Step 2 — Fix crashes from Step 1

- [ ] No startup crash or reload loop
- [ ] Re-test development build after any fixes

## Step 3 — TestFlight build (preview profile, OTA off)

- [ ] `eas build --profile preview --platform ios` **or** use existing verified **1.1.0** TestFlight/App Store build when no native build is authorized
- [ ] Submit / install via TestFlight (internal)
- [ ] Repeat Step 1 checklist on that binary

## Step 4 — Verify TestFlight BEFORE enabling OTA (≥ 24 hours)

Run a **≥ 24-hour** smoke on the Step 3 binary. Include authenticated personas:

| Persona | Required checks |
|---|---|
| **Free (signed-in, no entitlement)** | Sign-in; Coach shows locked/subscribe path (no premium pick identity); Plans Subscribe requires signed-in session (#671); no global review unlock |
| **Go / Pro** | Entitlement unlocks premium Coach surfaces; `Purchases` identity stays on that Clerk `user_…`; purchase/restore only while signed in |
| **Apple Review account** | Server `APP_REVIEW_*` path; review sign-in; Plans; restore does **not** grant other accounts |
| **RevenueCat Restore** | Signed-out → auth gate (#671); signed-in correct account restores; wrong account must not inherit entitlement |
| **#672 Autofill (if shipping via OTA)** | Email/password fields offer Keychain AutoFill / Strong Password suggestions; HIBP still enforced |
| **#672 Apple→Plans (if shipping via OTA)** | With Apple button enabled in a later phase: return to Plans selection only, **no** auto-purchase. Today `APPLE_SIGN_IN_ENABLED=false` — verify email Plans `returnTo` path instead |

Stability:

- [ ] No boot loop / ErrorBoundary across the 24h window
- [ ] Cold launch ×3 still healthy at end of window
- [ ] Coach slate/chat usable or known empty-slate ops issue documented (see release readiness report)

**Only then** (repo root):

```bash
echo "testflight-VERIFIED $(date -u +%Y-%m-%dT%H:%MZ) runtime=1.1.0" > .ota-testflight-verified
```

Commit the marker if your process tracks it on `main`.  
`check-ota-production-freeze.sh` requires this file before production OTA publish/heal/force/republish/rollback scripts proceed.

---

## After Step 4 (not part of the gate file, but recommended)

- Step 5: Preview-channel OTA on `preview-ota` profile  
- Step 6: Production OTA only with owner approval + policy exception if required  

**Rollback preference for 1.1.0:** `scripts/rollback-production-ota.sh` (embedded), not an unverified republish group.
