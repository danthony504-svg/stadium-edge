---
name: Coach background-finish + replay
description: Mobile AI Coach builds that finish after the phone disconnects. Server keeps the model alive, stashes result, pushes; client replays. Operational gotchas + invariants.
---

# Coach background-finish + replay (mobile-only)

The Coach pick build used to die when the app was backgrounded. Now the SERVER
finishes the model after the socket drops, stashes the result, pushes; the
client replays it on return. **Invariant: this feature changes only WHERE/WHEN
the result is delivered — never the pick-building logic, prompts, or the HONESTY
rule.** A partial/aborted build must stash NOTHING (never deliver a truncated
ticket).

## Why background mode needs its own watchdog
In background mode the disconnect handler deliberately does NOT abort the
upstream model (that's the whole point — keep generating). The cost: a hung
upstream would run forever. So a background-only watchdog (idle + max
wall-clock) aborts a genuinely stalled stream; the abort throws into the catch
and stays silent.

## The watchdog idle-source trap (cost us a review rejection)
`lastActivity` only advances while the client socket is alive (it also gates
`res.write`/heartbeats). Once the client is gone we stop writing, so
`lastActivity` FREEZES even while tokens keep arriving — the idle watchdog then
falsely aborts a long, still-streaming build. **The watchdog must measure real
upstream progress: update a separate timestamp on every received token
regardless of socket state, and check the watchdog against THAT, not
`lastActivity`.**

## Integrity invariants
- The stash is server-authored: its sync namespace is READABLE by the client
  but NOT WRITABLE, so a client can never overwrite it with fabricated picks.
- Push is at-most-once per build (dedupe log) and honors the global mute + the
  dedicated coachReady pref.
- Client replay reuses the stashed reply + prop pool with NO model re-call (no
  re-fetch, no fabrication).

## Client wiring notes
- AppState "background" (NOT "inactive") triggers handoff; "active" auto-restores.
- Force-quit fallback = local AsyncStorage pending build + notification-tap
  deep-link carrying the buildId.

## Terminal failure status (no silent limbo)
A background build that stalls (watchdog abort → `timedOut`) or errors / completes
empty (→ `failed`) now stashes a TERMINAL STATUS into the same `coachBuild` stash
— `{ buildId, status, createdAt }` with NO `full`/`props` (honesty: still never
deliver a partial ticket). Success stash carries `status:"ready"`. The catch path
distinguishes timedOut vs failed via a `watchdogAborted` flag (set inside the
watchdog before `upstreamAbort.abort()`); only stashes when `clientGone &&
bgUserId`. Failure push reuses `data.type:"coachReady"` deep-link but a distinct
dedupe key (`coachFailed:` vs `coachReady:`). Client `restoreBackgroundBuild`
checks `status` BEFORE the empty-`full` "still finishing" branch and renders a
recovery message + "Try again" button (carries the original prompt) — fires even
in `auto` mode. `CoachBuildStash.status` is optional (older stashes = ready).

## Remaining edge
On autoscale prod a TCP drop may kill the in-flight handler before EITHER finish
path runs (dev won't reproduce) — that still leaves no stash. The terminal-status
path only covers stalls/errors the handler itself observes.

## Client must self-heal a never-arriving stash (no endless "still building")
When the handler dies and NO stash (not even a terminal status) is written, the
old client sat on the "Still building your ticket… I'll notify you" line forever:
on foreground `restoreBackgroundBuild(auto)` saw `not-ready` and returned silently.
**Fix = client-side wait-timeout + poll, no infra needed:**
- `decideBackgroundRestore` takes `{now, maxWaitMs}`; a missing/empty stash whose
  `pending.createdAt + maxWaitMs <= now` becomes `failed/timedOut` (reuses the
  recovery + Try-again UI). A real terminal status or a ready result still WINS
  over the timeout. No opts = original wait-forever (keeps existing tests green).
- On hand-off, start a `setInterval` poll (`bgWatchId` state, ~10s) that re-checks
  the stash even if the user never re-foregrounds; cleared in replay/failed
  branches AND at the top of a fresh non-replay `send`.
- **Restore is MULTI-TRIGGER (poll + AppState "active" + push-tap) → needs an
  in-flight lock.** `restoredBuildRef` is checked BEFORE the async stash fetch so
  it can't stop two interleaved entrants from both replaying → add `restoringRef`
  (bail if set, acquire before await, release in `finally`) + a post-await recheck
  of `streamingRef`/`restoredBuildRef`. Window sized ~120s so a legitimately
  in-flight server build is never cut off. Client change → needs OTA/native build
  to reach installed app.
