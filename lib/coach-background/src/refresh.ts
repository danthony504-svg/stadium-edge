import { COACH_SNAPSHOT_MAX_AGE_MS, type CoachSnapshot } from "@workspace/coach-types";
import { isSnapshotFresh } from "@workspace/coach-cache";

export type BackgroundRefreshReason =
  | "missing"
  | "fingerprint_changed"
  | "stale"
  | "fresh";

export type BackgroundRefreshDecision = {
  refresh: boolean;
  reason: BackgroundRefreshReason;
};

/** Decide whether a cron tick should run a full scan + snapshot rebuild. */
export function shouldRunBackgroundRefresh(params: {
  snapshot: CoachSnapshot | null;
  contextFingerprint: string;
  nowMs?: number;
  maxAgeMs?: number;
}): BackgroundRefreshDecision {
  const nowMs = params.nowMs ?? Date.now();
  const maxAgeMs = params.maxAgeMs ?? COACH_SNAPSHOT_MAX_AGE_MS;

  if (!params.snapshot) {
    return { refresh: true, reason: "missing" };
  }
  if (params.snapshot.fingerprint !== params.contextFingerprint) {
    return { refresh: true, reason: "fingerprint_changed" };
  }
  if (!isSnapshotFresh(params.snapshot, nowMs, maxAgeMs)) {
    return { refresh: true, reason: "stale" };
  }
  return { refresh: false, reason: "fresh" };
}
