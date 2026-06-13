---
name: Coach background-build autoscale sweeper
description: Why background Coach parlay builds need a durable in-flight marker + cron sweeper, and the marker-clearing invariant that prevents phantom failures.
---

On autoscale, a TCP drop can kill the in-flight /chat handler before EITHER its
success or failure finish-path runs — so neither a "ready" nor a terminal
"failed" outcome is ever written and the returning user is left in silent limbo.
The in-handler watchdog does NOT cover this: it only fires while the handler
process is alive.

**Decision:** durable in-flight MARKER (written when streaming starts) + a cron
SWEEPER that finalizes any marker older than a deadline as a terminal failure
(no picks — honesty preserved). Reuse the existing "failed" status so the client
needs no change.

**Why a separate marker namespace:** the marker is purely internal server state
— keep it out of the client sync read/write whitelists so it stays
integrity-safe and invisible.

**Invariant — every live terminal path must retire the marker.** Not just the
background-stash paths: normal in-app completion and the live-client error path
call no stash function, so they must clear the marker explicitly. Miss one and
the sweeper later finalizes a happily-delivered ticket as a phantom "failed".
**How to apply:** whenever you add/branch a terminal outcome in the chat
handler, ensure that branch clears the pending marker. The live terminal
sequencing now lives in `coachBuild.ts` helpers `finalizeCompletedBuild`
(success branch) and `finalizeErroredBuild` (catch branch) — chat.ts delegates
to them and only keeps the SSE writes — so the marker-clearing WIRING is
integration-tested against real Postgres (coachBuildSweepIntegration.test.ts
scenarios F/G). Keep editing those helpers, not a re-inlined copy, or you lose
that coverage.

**Why the sweeper must run unconditionally in cron.** The notification job has
early returns ("no push tokens" / "no users") before its push fan-out. The sweep
is independent of that fan-out and MUST run before those early returns, or
abandoned builds are silently re-stranded.

**Concurrency invariant — marker cleanup must be conditional, never a bare
delete by (userId, namespace).** The marker row is latest-wins (one per user),
so between the sweeper READING a stale marker and DELETING it, a new build can
overwrite the row; an unconditional delete then clobbers the new build's marker
and re-opens the silent-limbo gap. Fix: delete atomically guarded by the stored
buildId (jsonb `data->>'buildId' = $buildId`) for valid markers, or by the exact
`updatedAt` row-version for malformed (no-buildId) markers. Same reasoning means
`clearBackgroundBuildPending` must be a SINGLE buildId-matched delete, not
select-then-delete.

**Other guards:** shared failure dedupe key across handler + sweeper =
at-most-once. Sweeper finalizes only if no terminal outcome already exists for
that build (never overwrite a real "ready"). Pure decision logic is factored
into a side-effect-free helper so it's unit-testable without a database (the
concurrency safety itself lives in the SQL predicates — needs real Postgres to
exercise).

## Retention / cleanup of terminal records
Terminal background-build bookkeeping grows otherwise-unbounded: the per-build `notif_log` dedupe rows (`coachReady:`/`coachFailed:` prefixes — one NEW row per build) and the per-user `coachBuild` outcome stash (latest-wins so bounded, but stale once games are over). `pruneOldCoachBuilds` (coachBuild.ts) deletes both older than `COACH_BUILD_RETENTION_MS` (7d), folded into the same notification cron AFTER the sweep (no new schedule). Pure `pruneCutoffMs(now, retentionMs)` lives in coachBuildSweep.ts for unit-testing.
**Why safe for at-most-once:** retention (7d) dwarfs the build lifecycle (BG_MAX_MS 240s + 8-min sweep deadline), so nothing live re-touches a build old enough to prune; dedupe rows are only needed within that window.
**Gotcha:** the notif_log delete MUST be scoped to the `coachReady:%`/`coachFailed:%` dedupeKey prefixes (LIKE), or it would nuke reminder/result/daily/upset dedupe rows the cron jobs own. Each delete is independently try-wrapped/fail-safe so it can't break the cron run.
