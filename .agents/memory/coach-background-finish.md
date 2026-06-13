---
name: Coach background-finish + replay
description: Mobile AI Coach parlay builds that finish after the phone disconnects — server keeps the model alive, stashes the result, pushes; client replays. Changes only delivery, never pick logic/honesty.
---

# Coach background-finish + replay

Mobile-only. The Coach pick build used to die when the app was backgrounded
(stream stalls → fail). Now the SERVER finishes the model after the socket
drops, stashes the result, and pushes; the client replays the stash on return.
The HONESTY rule and all pick-building logic/prompts are UNCHANGED — only
WHERE/WHEN the result is delivered.

## Server (chat.ts)
- Opt-in via `notifyOnBackground` + `buildId` in the POST body; `bgUserId` set
  only when both present AND the request is authed (chatUserId).
- `res.on("close")`: in background mode do NOT abort upstream (keep generating);
  set `clientGone`, guard every `res.write` with `!clientGone`. Non-bg keeps the
  old behavior (abort on disconnect to save tokens).
- Stream loop accumulates `fullText`; `if (clientGone && !bgUserId) break`.
- After done: `if (clientGone && bgUserId && fullText.trim())` →
  stashAndNotifyBackgroundBuild (upsert finished reply + exact prop pool into
  userSyncTable namespace "coachBuild", latest-wins; honor master + coachReady
  prefs from namespace "notifPrefs"; at-most-once via notifLogTable dedupe
  `coachReady:<user>:<build>`; clean invalid push tokens).

## WATCHDOG (the non-obvious gotcha)
Because background mode deliberately does NOT abort on disconnect, a hung
upstream would run FOREVER (resource leak). Background-only watchdog
(`startWatchdog`, armed in the close handler when bgUserId): idle 60s / max
240s → `upstreamAbort.abort()`. Aborted/partial builds throw into catch and
stash NOTHING (never deliver a truncated ticket). Call `stopWatchdog()`
everywhere `stopHeartbeat()` is called.

## Stash is server-authored (sync.ts)
Namespaces split into READABLE (incl. coachBuild) vs WRITABLE (excl.
coachBuild). The client may GET coachBuild but never PUT it — a client can't
overwrite the stash with fabricated picks.

## Client (coach.tsx)
- AsyncStorage PENDING_BUILD save/load/clear (force-quit fallback).
- AppState "background" (NOT "inactive") → abort + handoff; "active" → auto
  restore. Notification tap deep-links `/coach?buildId=...` (notifications.ts
  case "coachReady"); params.buildId effect triggers restore.
- `send(opts.replay)` reuses stashed `full` + props + saved context with NO
  model re-call (no re-fetch, no fabrication). Stat-card skipped on replay.
- New "coachReady" notif pref (DEFAULT_PREFS true) in api.ts NotifPrefs +
  notifyJobs Prefs + notifications.tsx settings row.

## RISK
On autoscale prod a TCP drop may kill the in-flight handler before the finish
path runs (dev won't reproduce). Local AsyncStorage + push-tap replay are the
fallback. Possible follow-up: persist a terminal failed/timedOut status so the
client shows deterministic recovery instead of silent limbo.
