// Pure decision logic for the abandoned background-Coach-build sweeper, factored
// out of coachBuild.ts so it can be unit-tested without a database. Given an
// in-flight marker, the (optional) terminal stash already written for that
// build, and the current time, it decides what the sweeper should do. Keeping
// this side-effect-free and import-free is deliberate: the db-coupled sweeper in
// coachBuild.ts maps these actions onto db operations.

export type SweepAction =
  // Marker is still within the deadline — a handler may legitimately still be
  // running; leave it alone.
  | { kind: "skip" }
  // Remove the marker without writing a failure: it's malformed, or a terminal
  // outcome for this build was already persisted (don't clobber a real result).
  | { kind: "clearMarker" }
  // The handler died before any finish-path ran — finalize as a terminal
  // failure (which also retires the marker).
  | { kind: "finalizeFailed"; buildId: string };

export function decideSweepAction(
  marker: { buildId?: string; createdAt?: string } | null | undefined,
  stash: { buildId?: string; status?: string } | null | undefined,
  now: number,
  staleMs: number,
): SweepAction {
  const buildId = marker?.buildId;
  const createdAt = marker?.createdAt ? Date.parse(marker.createdAt) : NaN;
  // Malformed marker — clean it up so it doesn't accumulate.
  if (!buildId || Number.isNaN(createdAt)) return { kind: "clearMarker" };
  // Still inside the deadline.
  if (now - createdAt < staleMs) return { kind: "skip" };
  // Did the handler already persist a terminal outcome for THIS build before it
  // died? If so, don't overwrite it — just retire the stale marker.
  const terminalReached =
    !!stash &&
    stash.buildId === buildId &&
    (stash.status === "ready" ||
      stash.status === "failed" ||
      stash.status === "timedOut");
  if (terminalReached) return { kind: "clearMarker" };
  return { kind: "finalizeFailed", buildId };
}

// Pure retention math for the terminal-record pruner (kept here, side-effect-
// free, so it's unit-testable; the db-coupled pruner in coachBuild.ts maps it
// onto DELETEs). Returns the cutoff epoch-ms at/before which a terminal
// background-build bookkeeping row (the per-user `coachBuild` outcome stash and
// the per-build `notif_log` dedupe rows) is old enough to delete. Because the
// retention window dwarfs the few-minute build lifecycle, nothing live ever
// re-touches a row this old — so pruning can't weaken the at-most-once push
// guarantee within the dedupe window.
export function pruneCutoffMs(now: number, retentionMs: number): number {
  return now - retentionMs;
}
