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

## Open risk / follow-up
On autoscale prod a TCP drop may kill the in-flight handler before the finish
path runs (dev won't reproduce). Possible follow-up: persist a terminal
failed/timedOut status so the client shows deterministic recovery instead of
silent limbo (proposed as a follow-up task).
