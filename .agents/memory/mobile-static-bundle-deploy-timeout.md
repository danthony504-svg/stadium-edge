---
name: Mobile static Expo Go bundle deploy timeout
description: Why a Replit publish can fail in the stadium-mobile build step even when api/web build fine, and how the bundle-download timeouts work.
---

# Mobile static Expo Go bundle deploy timeout

A Replit deployment publish builds **every** artifact, including stadium-mobile via
its production build `node scripts/build.js` (the static Expo Go hosted-bundle path —
distinct from the EAS native/TestFlight build). If that step exits non-zero, the
**whole publish fails** even though api-server and stadium-edge built successfully.

`scripts/build.js` starts a local Metro server and then **fetches** the iOS and
Android bundles over `http://localhost:8081/.../entry.bundle`. Metro does not start
streaming the HTTP response until it has finished bundling, so the *entire* bundle
build (React Compiler + every module) counts against that single fetch's timeout.

**Why:** As the app grows, the iOS bundle build crosses the old hard-coded
**5-minute** per-download cap and the fetch is aborted right at ~99.9% (logs show
`Download timeout after 5m: .../entry.bundle?platform=ios`). It is NOT a code/compile
error and NOT a transient — it is a slow-but-progressing bundle hitting a fixed cap.

**How to apply:**
- Symptom in build logs: api/web OK, then Metro reaches ~99.9% (N/N modules) and
  `ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL @workspace/stadium-mobile build: node scripts/build.js`.
- Fix is to raise the timeouts in `scripts/build.js`, not to change app code:
  - per-download (`downloadFile`) and `downloadManifest` share `BUNDLE_DOWNLOAD_TIMEOUT_MS`.
  - the overall cap in `main()` must stay **above** the sum of the sequential
    per-step guards (kept at `3 * BUNDLE_DOWNLOAD_TIMEOUT_MS`) so a specific stuck
    download fires its own clear error first instead of the generic overall timeout.
- These are generous caps to absorb a growing-but-healthy bundle; they still bound a
  genuine Metro stall. If the bundle keeps growing, raise the shared constant.
- Deeper lever (not done here, would change behavior): React Compiler is enabled and
  adds significant bundling time — disabling it would speed the build but is a
  behavior change, so only do it if asked.
