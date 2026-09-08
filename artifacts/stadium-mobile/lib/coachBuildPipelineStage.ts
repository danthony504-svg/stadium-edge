// Request-scoped pipeline stage markers — drive workflow index from completed work.

import type { CoachFinalizeRecord } from "./coachFinalize.ts";

export type CoachBuildPipelineStageKey =
  | "pricingStarted"
  | "evScored"
  | "simulated"
  | "confidenceScored";

export type CoachBuildPipelineStageTimestamps = Partial<
  Record<CoachBuildPipelineStageKey, number>
>;

const stageTimestamps = new Map<string, CoachBuildPipelineStageTimestamps>();

export function resetCoachBuildPipelineStagesForTests(): void {
  stageTimestamps.clear();
}

export function markCoachBuildPipelineStage(
  requestId: string,
  stage: CoachBuildPipelineStageKey,
): void {
  const prior = stageTimestamps.get(requestId) ?? {};
  if (prior[stage]) return;
  stageTimestamps.set(requestId, { ...prior, [stage]: Date.now() });
  console.log(`[coach-build-stage] requestId=${requestId} stage=${stage} t=${Date.now()}`);
}

export function getCoachBuildPipelineStages(
  requestId: string | null | undefined,
): CoachBuildPipelineStageTimestamps {
  if (!requestId) return {};
  return stageTimestamps.get(requestId) ?? {};
}

export function clearCoachBuildPipelineStages(requestId: string): void {
  stageTimestamps.delete(requestId);
}

/** Integer workflow index from completed pipeline stages (no elapsed timers). */
export function coachBuildStageWorkflowIndex(
  finalizeRecord: CoachFinalizeRecord | null,
  stages: CoachBuildPipelineStageTimestamps,
  injuryComplete: boolean,
): number {
  if (
    finalizeRecord?.phase === "complete" ||
    (finalizeRecord?.phase === "empty" && finalizeRecord.cardsSaved)
  ) {
    return 9;
  }
  if (finalizeRecord?.phase === "interrupted") return 9;
  if (finalizeRecord?.phase === "finalizing") return 8;
  if (finalizeRecord?.correlationCompleteAt) return 7;
  if (
    finalizeRecord?.correlationStartedAt &&
    !finalizeRecord.correlationCompleteAt
  ) {
    return 6;
  }
  if (finalizeRecord?.lineValueReadyAt) return 5;
  if (stages.confidenceScored || stages.simulated || stages.evScored || stages.pricingStarted) {
    return 5;
  }
  if (injuryComplete) return 4;
  return 3;
}
