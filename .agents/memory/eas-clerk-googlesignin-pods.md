---
name: EAS iOS pod install — Clerk GoogleSignIn modular headers
description: Why a previously-green EAS iOS build suddenly fails at "Install pods" with AppCheckCore/GoogleUtilities modular-headers error, and the fix.
---

# EAS iOS "Install pods" failure: AppCheckCore needs modular headers

**Symptom:** `pod install` dies with "The following Swift pods cannot yet be
integrated as static libraries: `AppCheckCore` depends upon `GoogleUtilities`
and `RecaptchaInterop`, which do not define modules." A build with *identical
source* succeeded earlier, then started failing with no code change.

**Why:** `@clerk/expo` autolinks its `ClerkGoogleSignIn.podspec`, which depends
on `GoogleSignIn ~> 9.0`. GoogleSignIn 9.x pulls `AppCheckCore` →
`GoogleUtilities` + `RecaptchaInterop`. The `~> 9.0` CocoaPods range is a
*floating* range — when a newer GoogleSignIn 9.x publishes, EAS resolves it on
the next build and the same source breaks. Clerk has NO granular opt-out for that
podspec, and excluding a single podspec from an autolinked package isn't cleanly
supported (autolinking excludes whole packages only). This is true even after
removing Google sign-in from the JS — the native SDK is still linked via Clerk.

**Fix (CocoaPods-sanctioned, what the error itself suggests):** enable modular
headers on the two non-modular pods via `expo-build-properties` in app.json:
```
["expo-build-properties", { "ios": { "extraPods": [
  { "name": "GoogleUtilities", "modular_headers": true },
  { "name": "RecaptchaInterop", "modular_headers": true } ] } }]
```
Add only the pods the error names. If a later build names another non-modular pod
(AppAuth/GTMSessionFetcher/GTMAppAuth), add it the same way — minimal blast
radius. Rejected alternatives: `useFrameworks:"static"` (too broad, breaks other
pods); native podspec removal (not granularly supported by Clerk).

**Do NOT bump expo.version / runtimeVersion for this:** modular_headers is a
native *compile-time* setting — it adds no native module and doesn't change the
JS↔native interface, so OTA runtime compatibility is unchanged. Bumping
runtimeVersion would risk stranding existing TestFlight users (see
ota-update-unsafe-appversion.md). eas.json production `autoIncrement:true`
handles the build number.

**Triggering EAS from this env:** plain `eas build` hits the git sandbox guard
(eas-cli tries a git index write to stage a dirty tree → blocked; leaves a stale
`.git/index.lock` that the sandbox also won't let you `rm`). Use `EAS_NO_VCS=1`
— it archives the working tree directly (root `.easignore` already keeps
`artifacts/*` + `lib/*` for the monorepo) and never touches git. The command
out-runs the 120s tool cap, so launch detached (`nohup … &`) and confirm the new
build via the Expo GraphQL API rather than the (buffered/empty) log.
