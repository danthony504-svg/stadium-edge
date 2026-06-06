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
