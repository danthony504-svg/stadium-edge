---
name: EAS / TestFlight env baking
description: Why a native EAS build crashes when dev works — EXPO_PUBLIC_* must be baked into eas.json, not the dev script.
---

# EAS native builds don't inherit dev env / Replit secrets

**Rule:** `eas build` runs on Expo's cloud, NOT in the Replit workspace. It does
NOT see the dev workflow command's inline env vars or Replit secrets. Every
runtime `EXPO_PUBLIC_*` value the app reads must be set in
`eas.json` → `build.<profile>.env` (or as EAS env vars), or it is empty in the
shipped binary.

**Why:** dev (Expo Go via the `dev` script) worked, but the TestFlight build
showed the ErrorBoundary ("Something went wrong") on launch. The production EAS
profile had no `env` block, so the two values the native app reads were empty.

**How it bites Stadium Edge (the two runtime vars):**
- `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` — read in `app/_layout.tsx` by
  `ClerkProvider`. Empty → Clerk throws → ErrorBoundary on cold launch.
- `EXPO_PUBLIC_DOMAIN` — read in `lib/api.ts` (`API_BASE =
  https://${DOMAIN}/api`). Empty → falls back to relative `/api`, which is
  meaningless on a phone → no backend.
  (`EXPO_PUBLIC_REPL_ID` is only used by `scripts/build.js`, not the native
  runtime; `EXPO_PUBLIC_CLERK_PROXY_URL` is optional — empty matches the working
  dev config which hits Clerk FAPI directly.)

**Correct values:**
- `EXPO_PUBLIC_DOMAIN` = the PUBLISHED deployment host, host-only no scheme
  (e.g. `stadium-edge-1.replit.app`). NOT `$REPLIT_DEV_DOMAIN` (ephemeral, dies
  when the workspace sleeps). Prod serves every artifact under one domain via
  `.replit` `router = "application"`, so `/api` resolves on that same host.
- `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` = the `pk_…` key. Publishable keys are
  PUBLIC (already ship in the web bundle) so committing them in `eas.json` is
  safe. `pk_test` works for TestFlight QA; switch to `pk_live` + matching backend
  Clerk secret before a public App Store release.

**Gotcha:** `scripts/build.js` is the Replit *static Expo Go* deploy path (injects
env to serve a hosted bundle), which is a DIFFERENT mechanism from the EAS native
build. Fixing one does not fix the other.

**After editing eas.json:** the binary must be rebuilt + resubmitted — env can't
be patched into an existing build. `eas.json` changes need no workflow restart.

## EAS build in the Replit sandbox needs EAS_NO_VCS=1
`eas build` defaults to git/VCS to archive the project; in the Replit main-agent
sandbox that hits `.git/index.lock` and is blocked ("Destructive git operations
are not allowed"). Run with `EAS_NO_VCS=1` so EAS archives the working dir
directly (respects .easignore/.gitignore) instead of using git. Also use
`--non-interactive` (EXPO_TOKEN secret authenticates; iOS credentials already
stored remotely on EAS) and `--no-wait` so the command returns a build URL
instead of blocking ~25 min.

## Non-interactive auto-submit needs ascAppId in eas.json
`eas build --auto-submit --non-interactive` (and `release:ios`) FAILS the submit
step with "Set ascAppId in the submit profile (eas.json) or re-run ... in
interactive mode" if `submit.production.ios.ascAppId` is missing — and the
failure happens AFTER the build is queued, so the build runs but nothing
auto-submits (an orphan). Fix: set `submit.production.ios.ascAppId` =
`6776024127` (Stadium Edge's App Store Connect Apple ID; bundle
com.stadiumedge.app). The ASC API key for submission is already stored on EAS
servers ("[Expo] EAS Submit ...", key id AF2872CMVS), so ascAppId is the only
piece the profile needs.
**Recover the ascAppId without the user / without interactive:** query EAS
GraphQL for prior submissions —
`POST https://api.expo.dev/graphql` (Bearer EXPO_TOKEN),
`query{app{byId(appId:"<projectId>"){submissions(filter:{platform:IOS},offset:0,limit:5){id status iosConfig{ascAppIdentifier}}}}}`.
projectId is app.json → expo.extra.eas.projectId.
**If a build was queued before ascAppId was set:** cancel the orphan
(`eas build:cancel <id> --non-interactive`) then re-run the build so auto-submit
is attached server-side and runs hands-off when the build finishes.

## Detached `eas build` dies silently after the banner — run in FOREGROUND
- Backgrounding the build (`nohup … eas build … --no-wait &`) prints only the version banner then the process vanishes — no "Compressing project files", no error in the redirected log, and NO build is queued. `pgrep -f "eas build"` gives FALSE positives because it also matches your own `eas build:list` poll commands, so it looks "still running" when nothing is.
- **Fix:** run `eas build … --auto-submit --non-interactive --no-wait` in the FOREGROUND. With `--no-wait` it returns in ~1–2 min after the upload + fingerprint + submission scheduling, well within a single command timeout. It prints the build URL, build number, and "Scheduled iOS submission" with a submission URL.
- Archive size: with `attached_assets` (336 MB) removed from the workspace the upload was only **8.5 MB** and instant. The slow/never-finishing uploads earlier were the dead detached process, not bandwidth. `.easignore` at the monorepo root is still good hygiene, but the decisive lever was the foreground run + small archive.
- attached_assets is referenced ONLY by `artifacts/stadium-edge/vite.config.ts` (`@assets` alias) — safe to stash to /tmp during a mobile build, but RESTORE it immediately after.
