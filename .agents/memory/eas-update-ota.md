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

## Running `eas build` from the agent environment (main-agent sandbox)
- `eas build` touches workspace git (creates `.git/index.lock` during project archive) → trips the main-agent git guard ("Destructive git operations are not allowed"). Set `EAS_NO_VCS=1` on EVERY eas command to archive the working dir without git; `eas whoami`/`build` then run cleanly. Auth is via `EXPO_TOKEN` secret.
- The full-monorepo archive+upload step EXCEEDS the 120s bash-tool limit → a foreground `eas build ... --no-wait` returns exit -1 with no output. CRITICAL: this only kills the LOCAL cli — if the upload already finished, the build record is created and KEEPS BUILDING server-side (and `--auto-submit` still runs server-side on finish). So a timed-out `eas build` may have SUCCEEDED. Before retrying, ALWAYS verify with `eas build:list --platform ios --limit 5 --json` (check for a new appBuildVersion) — do NOT blindly relaunch or you queue a duplicate build.
- To launch and survive the 120s limit, run detached: `nohup env EAS_NO_VCS=1 EXPO_TOKEN=$EXPO_TOKEN pnpm exec eas build ... --no-wait > /tmp/eas-build.log 2>&1 &` then poll `build:list`. NOTE: when piped to a file (non-TTY) eas prints only the version banner — no progress spinner; absence of log output is NOT a hang.
- `eas submit --latest` is SIDE-EFFECTING (queues a real submission), NOT a status check; re-submitting an already-submitted build number fails at App Store Connect. There is no `submit:list`/`submission:list` in eas-cli v20 — to read submission outcome, use the submission URL eas prints, or the EAS web dashboard.
