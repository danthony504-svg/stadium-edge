---
name: EAS Update (OTA) setup for stadium-mobile
description: How over-the-air JS updates are wired for the Expo app and the rebuild/version rules that make them work.
---

# EAS Update (over-the-air JS updates)

stadium-mobile uses EAS Update so JS-only changes reach installed apps without a new
native build / TestFlight cycle.

Wiring (all in `artifacts/stadium-mobile/`):
- `expo-updates` is a dependency (SDK 54 → ~29.x).
- `app.json` → `updates.url = https://u.expo.dev/<eas.projectId>` and
  `runtimeVersion: { policy: "appVersion" }`.
- `eas.json` build profiles carry a `channel`: `preview` → "preview", `production` → "production".
  A binary built from a profile only listens to that channel.

**Why `appVersion` policy:** simplest for a non-technical owner — runtime stays tied to
`expo.version` ("1.0.0"). `production.autoIncrement` bumps the build NUMBER, not `version`,
so every production build shares runtime "1.0.0" and all receive the same OTA stream.

**How to apply / hard rules:**
- Publish updates with `eas update --branch <production|preview> --message "..."` (or the
  `pnpm build:ios`/`submit:ios` shortcut scripts for full native builds).
- A binary built BEFORE expo-updates was added will NOT receive OTA — must rebuild + redistribute once.
- MANDATORY: bump `expo.version` whenever the native layer changes (new native module, plugin,
  config-plugin, permissions). OTA JS must never cross an incompatible native boundary on the
  same runtime version.
- OTA cannot change native code/permissions/icons — those always need a full build.

## Crash symptom: "Something went wrong / Try Again" on a PRODUCTION build right after an OTA
If the installed app is a production build (tell: the ErrorFallback's __DEV__-only debug button is ABSENT in the screenshot) and it worked, then crashed into the error boundary immediately after an `update:ios` OTA — suspect a NATIVE-MODULE MISMATCH, not the feature code. OTA ships JS only; with `runtimeVersion.policy = appVersion` pinned at an unchanged version (e.g. stuck "1.0.0" while expo-notifications / expo-image-picker / expo-local-authentication / expo-clipboard etc. were added over time), Expo still delivers the JS to the old binary, and the JS references native modules the binary lacks → throws at startup. A dev Metro restart does NOTHING for this (prod phone isn't connected to dev Metro). RECOVERY = a fresh NATIVE build installed via TestFlight (`run release:ios` = eas build --auto-submit), NOT another OTA. DURABLE FIX = bump `expo.version` whenever native deps change so OTAs only reach a matching new binary.

## DO NOT use runtimeVersion.policy = "fingerprint" in this pnpm monorepo
Tried switching app.json runtimeVersion policy from "appVersion" to "fingerprint" to make OTA compatibility automatic. `expo-updates fingerprint:generate` succeeded LOCALLY (exit 0) and EAS even computed a fingerprint runtime hash, BUT the EAS production build then ERRORED in the "Configure expo-updates build phase" (errorCode UNKNOWN_ERROR, vague). First build after the switch failed; prior appVersion-policy builds had succeeded. Fingerprint policy has known rough edges in pnpm workspaces. RESOLUTION: keep `policy: "appVersion"`. Deliver OTA-vs-native protection by PROCESS instead — ship native-module changes via a FULL build (`release:ios`), use OTA (`update:ios`) only for JS-only changes. eas.json here uses appVersionSource:"remote" so app.json expo.version does NOT drive the marketing version (managed remotely); don't expect a file-edit version bump to take effect.
