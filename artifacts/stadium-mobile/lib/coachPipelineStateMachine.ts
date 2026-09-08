/**
 * Formal Coach ticket-build pipeline phases after simulations.
 * Every transition is logged; a 2s stall watchdog dumps async stacks.
 */

export type CoachPipelinePhase =
  | "SCORING_CORRELATION"
  | "CORRELATION_TIMEOUT_FALLBACK"
  | "BUILDING_FINAL_TICKET"
  | "FINAL_TICKET_READY"
  | "COMPLETE";

export const COACH_PIPELINE_STALL_WATCHDOG_MS = 2_000;

type PipelineRun = {
  requestId: string;
  phase: CoachPipelinePhase;
  startedAt: number;
  lastTransitionAt: number;
  stallWatchdog: ReturnType<typeof setTimeout> | null;
  correlationTimedOut: boolean;
  settled: boolean;
};

const runs = new Map<string, PipelineRun>();

function logTransition(
  requestId: string,
  currentPhase: CoachPipelinePhase | "INIT",
  nextPhase: CoachPipelinePhase,
  reason: string,
  elapsedMs: number,
): void {
  console.log(
    "[coach-pipeline] state-transition",
    JSON.stringify({
      currentPhase,
      nextPhase,
      transitionReason: reason,
      requestId,
      elapsedMs,
    }),
  );
}

function dumpStallWatchdog(requestId: string, run: PipelineRun): void {
  const elapsedMs = Date.now() - run.startedAt;
  const sinceLastMs = Date.now() - run.lastTransitionAt;
  const err = new Error(
    `[coach-pipeline] stall-watchdog: no transition for ${sinceLastMs}ms in ${run.phase}`,
  );
  console.error(
    "[coach-pipeline] stall-watchdog",
    JSON.stringify({
      requestId,
      currentPhase: run.phase,
      elapsedMs,
      sinceLastTransitionMs: sinceLastMs,
      correlationTimedOut: run.correlationTimedOut,
    }),
  );
  console.error(err.stack);
}

function armStallWatchdog(requestId: string): void {
  const run = runs.get(requestId);
  if (!run || run.settled) return;
  if (run.stallWatchdog) clearTimeout(run.stallWatchdog);
  run.stallWatchdog = setTimeout(() => {
    const current = runs.get(requestId);
    if (!current || current.settled) return;
    dumpStallWatchdog(requestId, current);
    armStallWatchdog(requestId);
  }, COACH_PIPELINE_STALL_WATCHDOG_MS);
}

function clearStallWatchdog(run: PipelineRun): void {
  if (run.stallWatchdog) {
    clearTimeout(run.stallWatchdog);
    run.stallWatchdog = null;
  }
}

export function beginCoachPipelineCorrelation(requestId: string, reason = "correlation-handoff"): void {
  const now = Date.now();
  const prior = runs.get(requestId);
  if (prior) clearStallWatchdog(prior);

  const run: PipelineRun = {
    requestId,
    phase: "SCORING_CORRELATION",
    startedAt: now,
    lastTransitionAt: now,
    stallWatchdog: null,
    correlationTimedOut: false,
    settled: false,
  };
  runs.set(requestId, run);
  logTransition(requestId, "INIT", "SCORING_CORRELATION", reason, 0);
  armStallWatchdog(requestId);
}

export function transitionCoachPipeline(
  requestId: string,
  nextPhase: CoachPipelinePhase,
  reason: string,
): boolean {
  const run = runs.get(requestId);
  if (!run || run.settled) return false;

  const elapsedMs = Date.now() - run.startedAt;
  logTransition(requestId, run.phase, nextPhase, reason, elapsedMs);
  run.phase = nextPhase;
  run.lastTransitionAt = Date.now();
  armStallWatchdog(requestId);
  return true;
}

export function markCoachPipelineCorrelationTimedOut(requestId: string): void {
  const run = runs.get(requestId);
  if (!run) return;
  run.correlationTimedOut = true;
}

export function coachPipelineCorrelationTimedOut(requestId: string): boolean {
  return runs.get(requestId)?.correlationTimedOut === true;
}

export function coachPipelineCurrentPhase(requestId: string): CoachPipelinePhase | null {
  return runs.get(requestId)?.phase ?? null;
}

export function settleCoachPipeline(requestId: string, reason = "pipeline-settled"): void {
  const run = runs.get(requestId);
  if (!run) return;
  if (!run.settled) {
    transitionCoachPipeline(requestId, "COMPLETE", reason);
  }
  run.settled = true;
  clearStallWatchdog(run);
}

export function clearCoachPipelineState(requestId?: string): void {
  if (!requestId) {
    for (const run of runs.values()) clearStallWatchdog(run);
    runs.clear();
    return;
  }
  const run = runs.get(requestId);
  if (run) clearStallWatchdog(run);
  runs.delete(requestId);
}

/** Map formal pipeline phase → UI build stage id. */
export function coachBuildStageFromPipelinePhase(
  phase: CoachPipelinePhase,
): import("./coachBuildProgress.ts").CoachBuildStageId {
  switch (phase) {
    case "SCORING_CORRELATION":
      return "correlation";
    case "CORRELATION_TIMEOUT_FALLBACK":
      return "correlation-fallback";
    case "BUILDING_FINAL_TICKET":
      return "building-ticket";
    case "FINAL_TICKET_READY":
    case "COMPLETE":
      return "final-ticket";
    default:
      return "correlation";
  }
}
