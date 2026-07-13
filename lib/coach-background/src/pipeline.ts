import type {
  CoachLearningState,
  CoachSnapshot,
  CoachSportIdOrCustom,
  CoachSportRegistry,
} from "@workspace/coach-types";
import type { CoachNormalizedSlate } from "@workspace/coach-data";
import type { CoachSimService } from "@workspace/coach-sim";
import { rankQualifiedPool } from "@workspace/coach-rank";
import type { CoachSnapshotCache } from "@workspace/coach-cache";
import { runCoachScan, type CoachScanOptions } from "@workspace/coach-scan";

export type RunCoachBackgroundPipelineInput = {
  slate: CoachNormalizedSlate;
  registry: CoachSportRegistry;
  sim: CoachSimService;
  snapshotCache: CoachSnapshotCache;
  sportContext: CoachScanOptions["sportContext"];
  resolveGateContext?: CoachScanOptions["resolveGateContext"];
  sports?: CoachSportIdOrCustom[];
  learning?: CoachLearningState | null;
  gradeHook?: CoachScanOptions["gradeHook"];
  nowMs?: number;
  onProgress?: CoachScanOptions["onProgress"];
};

/**
 * Full background pipeline: scan every candidate → rank → persist snapshot.
 * Never stops early; gates remain fail-closed.
 */
export async function runCoachBackgroundPipeline(
  input: RunCoachBackgroundPipelineInput,
): Promise<CoachSnapshot> {
  const nowMs = input.nowMs ?? Date.now();
  const pool = await runCoachScan({
    slate: input.slate,
    registry: input.registry,
    sim: input.sim,
    sportContext: input.sportContext,
    resolveGateContext: input.resolveGateContext,
    sports: input.sports,
    gradeHook: input.gradeHook,
    nowMs,
    onProgress: input.onProgress,
  });

  const ranked = rankQualifiedPool(pool, { learning: input.learning ?? null });

  return input.snapshotCache.buildAndStore({
    ranked,
    manifest: pool.manifest,
    fingerprint: input.slate.contextFingerprint,
    activeSports: pool.manifest.sports,
    nowMs,
  });
}
