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
  runtime.)
- `EXPO_PUBLIC_CLERK_PROXY_URL` — **MANDATORY on the `production` profile (pk_live)**;
  see "Production Clerk is proxy-only" below. Omitting it = permanent blank navy
  screen on launch. It stays EMPTY only on `preview`/dev (pk_test → dev instance
  has a real direct FAPI). The earlier "it's optional" note was WRONG and caused
  blank installed builds.

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
- UPDATE: the foreground trigger can intermittently HANG at the project-archive step (>120s, only the eas-cli version banner prints) on a cold FS cache, exceeding the command timeout. `eas whoami` confirms auth/network are fine. Mitigations that worked: pass `EAS_SKIP_AUTO_FINGERPRINT=1` (runtimeVersion is a fixed string `1.0.0`, not a fingerprint policy, so the fingerprint is pure overhead), warm the FS cache first (a prior `eas whoami` / `ls`), then re-run foreground — it then schedules in <60s. Detached/`setsid`/`nohup` runs are KILLED by the sandbox between tool calls (empty log, gone PID) — do NOT rely on them. A timed-out (killed-mid-archive) run still BURNS a remote build number via `autoIncrement` (appVersionSource:remote), so build numbers can jump with gaps. Always confirm the real result via the Expo GraphQL `buildsPaginated` query, never the buffered CLI log.

## Production Clerk is PROXY-ONLY → mobile prod build MUST set EXPO_PUBLIC_CLERK_PROXY_URL
**Rule:** Stadium Edge's PRODUCTION Clerk instance has NO reachable direct Frontend
API. The pk_live key encodes `clerk.stadium-edge-1.replit.app`, but that host
resolves only to an internal `172.24.x` address and a direct request returns
HTTP 000 (no real FAPI). Clerk is reached ONLY through the api-server proxy at
`/api/__clerk` (clerkProxyMiddleware, `CLERK_PROXY_PATH`), which returns 200. The
deployed WEB app already works this way via `VITE_CLERK_PROXY_URL` +
`proxyUrl={clerkProxyUrl}`.
**So the mobile `production` profile in eas.json MUST set**
`EXPO_PUBLIC_CLERK_PROXY_URL = https://stadium-edge-1.replit.app/api/__clerk`
(host = EXPO_PUBLIC_DOMAIN, path = CLERK_PROXY_PATH). `_layout.tsx` reads it into
`proxyUrl` and passes it to `<ClerkProvider>`.
**Why it bit us:** prod profile had pk_live but NO proxy URL → `proxyUrl=undefined`
→ Clerk tried the dead direct FAPI → never loaded → `<ClerkLoaded>` (which renders
nothing while not-loaded) → **permanent silent blank navy screen** on installed
iOS builds. Swapping pk_test→pk_live alone was INSUFFICIENT.
**Belt-and-braces:** `<ClerkProvider>` now also renders `<ClerkLoading><BootScreen/></ClerkLoading>`
beside `<ClerkLoaded>` — BootScreen shows a spinner and, after a 15s timeout, a
Retry button (`expo-updates` `Updates.reloadAsync()`), so a future Clerk-load
failure can never again be a silent blank.
**dev/Expo Go (pk_test) is unaffected** — the Clerk DEV instance has a real direct
FAPI (`*.clerk.accounts.dev`), so no proxy is needed there; preview profile + the
`dev` script correctly leave the proxy URL empty.
