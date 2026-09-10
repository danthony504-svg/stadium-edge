/** Post-correlation coach pipeline tracing — identifies which await never resolves. */

export const COACH_FINAL_BUILD_TIMEOUT_MS = 15_000;
const LOG_PREFIX = "[coach-pipeline]";

export type CoachPipelineStage =
  | "correlationScored"
  | "candidatePropsReceived"
  | "filteringCompleted"
  | "rankingCompleted"
  | "ticketBuilt"
  | "aiResponseGenerated"
  | "responseReturned"
  | "loadingCleared";

export type CoachAsyncStage = "BuildFinalTicket" | "GenerateCoachResponse" | "ReturnResponse";

type StageMeta = Record<string, string | number | boolean | null | undefined>;

type PipelineState = {
  requestId: string | null;
  stages: Partial<Record<CoachPipelineStage, number>>;
  asyncStarts: Partial<Record<CoachAsyncStage, number>>;
  candidateCount: number | null;
  filteredCount: number | null;
  rankedCount: number | null;
  ticketLegCount: number | null;
  timeoutStage: CoachAsyncStage | null;
  timedOut: boolean;
};

const state: PipelineState = {
  requestId: null,
  stages: {},
  asyncStarts: {},
  candidateCount: null,
  filteredCount: null,
  rankedCount: null,
  ticketLegCount: null,
  timeoutStage: null,
  timedOut: false,
};

let stageTimer: ReturnType<typeof setTimeout> | null = null;
let timeoutHandler: ((stage: CoachAsyncStage, stack: string) => void) | null = null;

function log(line: string, meta?: StageMeta) {
  if (meta && Object.keys(meta).length > 0) {
    console.log(`${LOG_PREFIX} ${line}`, meta);
  } else {
    console.log(`${LOG_PREFIX} ${line}`);
  }
}

export function setCoachPipelineTimeoutHandler(
  handler: ((stage: CoachAsyncStage, stack: string) => void) | null,
) {
  timeoutHandler = handler;
}

export function resetCoachPipeline(requestId?: string) {
  if (stageTimer) {
    clearTimeout(stageTimer);
    stageTimer = null;
  }
  state.requestId = requestId ?? null;
  state.stages = {};
  state.asyncStarts = {};
  state.candidateCount = null;
  state.filteredCount = null;
  state.rankedCount = null;
  state.ticketLegCount = null;
  state.timeoutStage = null;
  state.timedOut = false;
}

export function updateCoachPipelineCounts(counts: {
  candidateCount?: number;
  filteredCount?: number;
  rankedCount?: number;
  ticketLegCount?: number;
}) {
  if (counts.candidateCount != null) state.candidateCount = counts.candidateCount;
  if (counts.filteredCount != null) state.filteredCount = counts.filteredCount;
  if (counts.rankedCount != null) state.rankedCount = counts.rankedCount;
  if (counts.ticketLegCount != null) state.ticketLegCount = counts.ticketLegCount;
}

export function markCoachPipelineStage(stage: CoachPipelineStage, meta?: StageMeta) {
  state.stages[stage] = Date.now();
  const labels: Record<CoachPipelineStage, string> = {
    correlationScored: "Correlation scored",
    candidatePropsReceived: "Candidate props received",
    filteringCompleted: "Filtering completed",
    rankingCompleted: "Ranking completed",
    ticketBuilt: "15-leg ticket built",
    aiResponseGenerated: "AI response generated",
    responseReturned: "Response returned to Coach",
    loadingCleared: "Loading state cleared",
  };
  const payload: StageMeta = { requestId: state.requestId ?? undefined, ...meta };
  if (stage === "candidatePropsReceived" && state.candidateCount != null) {
    payload.candidateCount = state.candidateCount;
    log(`2. Candidate count: ${state.candidateCount}`, payload);
  }
  log(labels[stage], payload);
}

export function clearCoachStageTimer() {
  if (stageTimer) {
    clearTimeout(stageTimer);
    stageTimer = null;
  }
}

export function armCoachStageTimer(stage: CoachAsyncStage, ms = COACH_FINAL_BUILD_TIMEOUT_MS) {
  clearCoachStageTimer();
  state.timeoutStage = stage;
  const stack = new Error(`coach-pipeline-timeout:${stage}`).stack ?? stage;
  stageTimer = setTimeout(() => {
    state.timedOut = true;
    log(`TIMEOUT after ${ms}ms — hanging await in ${stage}`, {
      requestId: state.requestId ?? undefined,
      stage,
      candidateCount: state.candidateCount,
      filteredCount: state.filteredCount,
      rankedCount: state.rankedCount,
      ticketLegCount: state.ticketLegCount,
      stack,
    });
    timeoutHandler?.(stage, stack);
  }, ms);
}

function endAsyncStage(stage: CoachAsyncStage) {
  const started = state.asyncStarts[stage];
  const elapsed = started != null ? Date.now() - started : 0;
  log(`END: ${stage} (${elapsed} ms)`, {
    requestId: state.requestId ?? undefined,
    candidateCount: state.candidateCount,
    ticketLegCount: state.ticketLegCount,
  });
  if (state.timeoutStage === stage) clearCoachStageTimer();
}

export async function withCoachStageTimeout<T>(
  stage: CoachAsyncStage,
  fn: () => Promise<T>,
  ms = COACH_FINAL_BUILD_TIMEOUT_MS,
): Promise<T> {
  state.asyncStarts[stage] = Date.now();
  log(`START: ${stage}`, { requestId: state.requestId ?? undefined });
  armCoachStageTimer(stage, ms);
  try {
    const result = await fn();
    endAsyncStage(stage);
    return result;
  } catch (err) {
    endAsyncStage(stage);
    log(`ERROR in ${stage}`, {
      requestId: state.requestId ?? undefined,
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    throw err;
  }
}

export function coachPipelineTimeoutMessage(stage: CoachAsyncStage): string {
  return `_The ticket build timed out during **${stage}** (15s). The scan may still be running — try again or ask for fewer legs._`;
}

export function coachPipelineSnapshot() {
  return { ...state, stages: { ...state.stages } };
}
