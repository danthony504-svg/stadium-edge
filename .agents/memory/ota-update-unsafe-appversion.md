---
name: OTA (eas update) — history of the appVersion crash; now on fingerprint policy
description: Why OTA crashed the app under the old appVersion policy, and the conditions under which OTA is now safe (fingerprint)
---

# UPDATE: runtimeVersion policy is now "fingerprint"

The `appVersion` policy below was the ROOT CAUSE of the OTA crash. It has since
been switched to `"policy": "fingerprint"` in app.json and a fresh baseline
build (iOS Build #33) was cut to embed the current JS + the fingerprint runtime.

**OTA is now safe ONCE the fingerprint-baseline build is the installed binary.**
Fingerprint derives runtimeVersion from the real native fingerprint, so EAS will
NOT serve a JS bundle to a native binary it doesn't match (the crash below can't
happen). Rules that still hold:
- `eas update` does NOT inherit eas.json build-profile env — run the export with
  the production `EXPO_PUBLIC_*` values or API_BASE falls back to "/api" and the
  Clerk key is empty. Ship via `eas update --branch production`.
- A change that touches NATIVE deps/config produces a NEW fingerprint; OTA won't
  reach the old binary (correctly) — that delta needs a fresh native build.
- Don't OTA onto a binary OLDER than the fingerprint baseline; install the
  baseline build first.

---

# (Historical) OTA update on stadium-mobile was unsafe under appVersion policy

`eas update --branch production` from current HEAD CRASHED the installed iOS app
on launch ("Something went wrong / Please reload" — the app's React error
boundary). Recovery: `eas update:roll-back-to-embedded --branch production
--runtime-version 1.0.0 --platform ios` (publishes a directive that reverts
clients to the native-embedded bundle on next relaunch). Roll-back is fast (no
bundling); the bad bundle bundling is what blows the 120s tool limit.

**Why it broke (root cause):**
- `app.json` runtimeVersion policy is `"appVersion"` pinned at `1.0.0`. That
  number does NOT change when native deps / Expo modules change, so EAS happily
  serves an OTA JS bundle to a native binary it is not actually compatible with.
- The installed App Store/TestFlight build was cut from an OLDER commit. Pushing
  HEAD JS over OTA fast-forwards the app's JavaScript by MANY commits of feature
  work at once — not just the one small fix — and any of that delta that touches
  a native module absent from the old binary (or a startup-time error) crashes
  the whole app.

**How to apply / rules:**
- Do NOT ship JS-only fixes to this app via `eas update` until the runtime policy
  is `"fingerprint"` (auto-detects native incompatibility) AND a fresh production
  build embeds the current JS as the new baseline.
- The SAFE way to ship a change to the live app today = a new native build:
  `eas build --platform ios --profile production` then `eas submit`
  (script: `release:ios`). That rebuilds native + embeds current JS.
- `eas update` does NOT inherit eas.json build-profile env; an OTA export must be
  run with the production EXPO_PUBLIC_* values or API_BASE falls back to "/api"
  (broken) and Clerk key is empty (auth broken). Even with env correct, the
  native-incompatibility above still applies.
