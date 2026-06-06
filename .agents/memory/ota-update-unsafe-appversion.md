---
name: OTA (eas update) is unsafe on stadium-mobile with appVersion runtime policy
description: Why pushing an OTA JS bundle to the production app crashed it on launch, and how to recover / ship safely
---

# OTA update on stadium-mobile is unsafe right now

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
