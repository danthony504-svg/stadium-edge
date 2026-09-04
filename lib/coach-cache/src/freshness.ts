import {
  COACH_SNAPSHOT_INSTANT_SERVE_MAX_MS,
  COACH_SNAPSHOT_MAX_AGE_MS,
  type CoachSnapshot,
} from "@workspace/coach-types";

export type SnapshotFreshness = {
  ageMs: number;
  fresh: boolean;
  instantServe: boolean;
  serveable: boolean;
};

export function snapshotAgeMs(snapshot: CoachSnapshot, nowMs = Date.now()): number {
  return Math.max(0, nowMs - snapshot.at);
}

export function isSnapshotFresh(
  snapshot: CoachSnapshot,
  nowMs = Date.now(),
  maxAgeMs = COACH_SNAPSHOT_MAX_AGE_MS,
): boolean {
  return snapshotAgeMs(snapshot, nowMs) <= maxAgeMs;
}

/** Stale-but-valid window while a background refresh is running. */
export function isSnapshotInstantServeable(
  snapshot: CoachSnapshot,
  nowMs = Date.now(),
  maxMs = COACH_SNAPSHOT_INSTANT_SERVE_MAX_MS,
): boolean {
  return snapshot.serveable && snapshotAgeMs(snapshot, nowMs) <= maxMs;
}

export function evaluateSnapshotFreshness(
  snapshot: CoachSnapshot,
  nowMs = Date.now(),
  maxAgeMs = COACH_SNAPSHOT_MAX_AGE_MS,
  instantServeMaxMs = COACH_SNAPSHOT_INSTANT_SERVE_MAX_MS,
): SnapshotFreshness {
  const ageMs = snapshotAgeMs(snapshot, nowMs);
  const fresh = ageMs <= maxAgeMs;
  const instantServe = snapshot.serveable && ageMs <= instantServeMaxMs;
  return {
    ageMs,
    fresh,
    instantServe,
    serveable: snapshot.serveable,
  };
}
