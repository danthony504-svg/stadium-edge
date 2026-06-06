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
