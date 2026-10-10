import type { SlatePreAnalysisSnapshot } from "./coachSlateTypes.js";

/**
 * Only complete deep-sim snapshots may replace the published `global` row.
 * Incomplete / partial snapshots must never overwrite a prior successful slate.
 */
export function shouldPublishCoachSlateSnapshot(
  snapshot: Pick<SlatePreAnalysisSnapshot, "deepSimComplete"> | null | undefined,
): boolean {
  return snapshot?.deepSimComplete === true;
}
