import type { CoachScanStatus, CoachSnapshot } from "@workspace/coach-types";
import type { CoachRawSlateInput } from "@workspace/coach-data";
import { normalizeCoachSlate } from "@workspace/coach-data";
import type { CoachSnapshotCache } from "@workspace/coach-cache";

import { runCoachBackgroundPipeline, type RunCoachBackgroundPipelineInput } from "./pipeline";
import { shouldRunBackgroundRefresh } from "./refresh";
import type { ScanStatusStore } from "./status";
import { createInitialScanStatus } from "./status";

export type CoachBackgroundTickInput = Omit<
  RunCoachBackgroundPipelineInput,
  "slate" | "snapshotCache"
> & {
  rawSlate: CoachRawSlateInput;
  snapshotCache: CoachSnapshotCache;
  statusStore?: ScanStatusStore;
};

export type CoachBackgroundTickOutcome =
  | "skipped_fresh"
  | "skipped_running"
  | "refreshed"
  | "failed";

export type CoachBackgroundTickResult = {
  outcome: CoachBackgroundTickOutcome;
  snapshot: CoachSnapshot | null;
  status: CoachScanStatus;
  refreshReason?: string;
  error?: string;
};

function runningStatus(manifest: CoachScanStatus["manifest"], nowMs: number): CoachScanStatus {
  return {
    jobRunning: true,
    manifest,
    lastError: null,
    updatedAt: new Date(nowMs).toISOString(),
  };
}

/**
 * Cron entry point — skips work when snapshot is fresh for the current slate
 * fingerprint, otherwise runs the full scan pipeline.
 */
export async function coachBackgroundTick(
  input: CoachBackgroundTickInput,
): Promise<CoachBackgroundTickResult> {
  const nowMs = input.nowMs ?? Date.now();
  const statusStore = input.statusStore;
  const slate = normalizeCoachSlate(input.rawSlate, {
    nowMs,
    sports: input.sports,
  });

  const current = await input.snapshotCache.get();
  const decision = shouldRunBackgroundRefresh({
    snapshot: current,
    contextFingerprint: slate.contextFingerprint,
    nowMs,
  });

  const statusSnapshot = statusStore ? await statusStore.get() : createInitialScanStatus(nowMs);

  if (!decision.refresh) {
    return {
      outcome: "skipped_fresh",
      snapshot: current,
      status: {
        ...statusSnapshot,
        jobRunning: false,
        manifest: current?.manifest ?? statusSnapshot.manifest,
        updatedAt: new Date(nowMs).toISOString(),
      },
    };
  }

  if (statusSnapshot.jobRunning) {
    return {
      outcome: "skipped_running",
      snapshot: current,
      status: statusSnapshot,
      refreshReason: decision.reason,
    };
  }

  if (statusStore) {
    await statusStore.set(runningStatus(current?.manifest ?? null, nowMs));
  }

  try {
    const snapshot = await runCoachBackgroundPipeline({
      ...input,
      slate,
      nowMs,
    });

    const done: CoachScanStatus = {
      jobRunning: false,
      manifest: snapshot.manifest,
      lastError: null,
      updatedAt: new Date(nowMs).toISOString(),
    };
    if (statusStore) await statusStore.set(done);

    return {
      outcome: "refreshed",
      snapshot,
      status: done,
      refreshReason: decision.reason,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const failed: CoachScanStatus = {
      jobRunning: false,
      manifest: current?.manifest ?? statusSnapshot.manifest,
      lastError: message,
      updatedAt: new Date(nowMs).toISOString(),
    };
    if (statusStore) await statusStore.set(failed);

    return {
      outcome: "failed",
      snapshot: current,
      status: failed,
      refreshReason: decision.reason,
      error: message,
    };
  }
}
