---
name: Push notifications (Expo mobile + api-server)
description: How the four-trigger push system is wired, and the non-obvious gotchas that bite when extending it.
---

# Push notifications

Mobile (stadium-mobile) registers an Expo push token after Clerk sign-in; the
api-server stores tokens + dedup state in Postgres and runs all time-based
triggers from a SECURED cron endpoint.

## Architecture
- api-server deploys AUTOSCALE → a background `setInterval` is unreliable. All
  triggers run inside `POST /api/notifications/cron`, guarded by header
  `x-cron-key` vs `process.env.NOTIFY_CRON_KEY`. A **Scheduled Deployment** must
  hit this endpoint (~every 15 min) for anything to fire — there is no in-process
  timer. NOTIFY_CRON_KEY is a generated shared env var; the same value must be set
  as the scheduled job's header.
- `lib/notifyJobs.ts` self-fetches the server's OWN `/api/sports/games` and
  `/api/sports/odds` over `http://127.0.0.1:$PORT` to reuse their caches — so the
  cron adds ZERO extra Odds API quota beyond a normal page load.
- Per-user slips + prefs are read straight from `userSyncTable` (namespaces
  `savedSlips` and `notifPrefs`). Prefs are written via a dedicated sanitizing
  endpoint, NOT added to the generic `/sync` whitelist (so clients can't write
  arbitrary pref shapes).
- Four triggers: game-start reminders, bet-results (NEUTRAL "games are final" —
  never win/loss, props can't be graded → never-fabricate), daily AI-picks nudge
  (once/UTC-day after DAILY_HOUR_UTC), odds/line movement.

## Gotchas (each cost real time)
- **@workspace/db is consumed via built `dist/*.d.ts`** through TS project
  references, even though its `exports` map points at `src` and esbuild bundles
  src at runtime. After adding a new table/schema file you MUST rebuild the db
  declarations (`pnpm --filter @workspace/db exec tsc -b --force`) or the
  api-server `tsc` typecheck fails with "no exported member" while runtime works
  fine. `pnpm --filter @workspace/db push` only touches Postgres, not the .d.ts.
- **ESPN game ids ≠ Odds API event ids.** Saved-slip legs resolve to ESPN game
  rows (`/sports/games`), but line-movement is computed from `/sports/odds`
  (Odds API event ids). You CANNOT join them by id — match by team name. Same
  tolerant matcher used everywhere here.
- **Fail-closed matching**: `gameMatchesLeg` requires BOTH teams' nickname tokens
  (last word, len≥3) present in the leg's game string, AND the leg→game resolve
  requires EXACTLY ONE candidate (0 or 2+ → skip). Prevents wrong-game alerts on
  nickname collisions (e.g. two "State" teams).
- **Dedup is at-most-once**: every send `claimSend`s a row in `notif_log`
  (composite PK userId+dedupeKey, onConflictDoNothing.returning()) BEFORE
  sending. Chosen over send-then-claim because double-sending push spam is worse
  than a rare dropped alert on transient Expo failure. No outbox/retry by design.
- **data.type strings must match on both ends**: server sends
  `reminder|result|dailyPicks|oddsMovement|test`; the mobile tap-router switch
  must use those exact strings (an earlier mismatch `result` vs `results` broke
  deep-linking silently).
- api-server has NO file watcher — restart the workflow after editing these
  files or it serves stale compiled code.

## Diagnosing "background build / pushes stopped working" in prod
- The whole time-based layer (sweeper + 4 triggers) is DARK unless a Scheduled
  Deployment runs `bash scripts/notifications-cron.sh` (~15 min). The inline
  "ready" push from a SURVIVING handler does NOT need cron, but the SWEEPER that
  recovers an autoscale-killed handler DOES — so a closed-app build whose socket
  dropped only gets its push via cron.
- **First check, always:** `GET https://<published>/api/notifications/cron/status`
  with header `x-cron-key: $NOTIFY_CRON_KEY`. `everRan:false` / `lastRunAt:null`
  / 503 stale ⇒ the Scheduled Deployment was never created or is failing. This is
  an OPERATIONAL gap (Publishing UI), not a code bug — confirmed here once with
  key set, tokens registered, code deployed, yet `everRan:false`.
- Cannot create a Scheduled Deployment programmatically (no agent tool); the user
  must add it in the Publishing tool. `scripts/notifications-cron.sh` mirrors
  `prebuild-cron.sh` so the run command is turnkey.
