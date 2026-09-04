// Instrumentation for the Coach final build stage (after "Correlation scored").
// No timers — trace-only. Search Metro logs for [coach-final-stage].

export type CoachFinalStageStep = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

const STEP_NAMES: Record<CoachFinalStageStep, string> = {
  1: "Correlation finished",
  2: "Final candidate selection started",
  3: "Final candidate selection completed",
  4: "Ticket creation started",
  5: "Ticket creation completed",
  6: "State update started",
  7: "progress = 100",
  8: "finalTicketReady = true",
  9: "isScanning = false",
  10: "Results rendered",
};

let lastReachedStep = 0;
let lastRequestId = "";

export function resetCoachFinalStageTrace(requestId?: string): void {
  lastReachedStep = 0;
  if (requestId) lastRequestId = requestId;
}

export function coachFinalStageLastReached(): { step: number; label: string; requestId: string } {
  return {
    step: lastReachedStep,
    label: STEP_NAMES[lastReachedStep as CoachFinalStageStep] ?? "none",
    requestId: lastRequestId,
  };
}

function stamp(step: CoachFinalStageStep, phase: string, meta?: Record<string, unknown>): void {
  if (step > lastReachedStep) lastReachedStep = step;
  const rid = meta?.requestId ?? lastRequestId;
  if (typeof rid === "string" && rid) lastRequestId = rid;
  const base = `[coach-final-stage] step ${step}/${STEP_NAMES[step]} — ${phase}`;
  if (meta && Object.keys(meta).length > 0) {
    console.log(base, meta);
  } else {
    console.log(base);
  }
}

export function traceFinalStageBefore(
  step: CoachFinalStageStep,
  location: string,
  meta?: Record<string, unknown>,
): void {
  stamp(step, `BEFORE (${location})`, meta);
}

export function traceFinalStageAfter(
  step: CoachFinalStageStep,
  location: string,
  meta?: Record<string, unknown>,
): void {
  stamp(step, `AFTER (${location})`, meta);
}

/** Execution stopped before this step — log why. */
export function traceFinalStageBlocked(
  nextStep: CoachFinalStageStep,
  location: string,
  reason: string,
  meta?: Record<string, unknown>,
): void {
  const prev = lastReachedStep;
  const prevLabel = STEP_NAMES[prev as CoachFinalStageStep] ?? "none";
  const nextLabel = STEP_NAMES[nextStep];
  console.warn(
    `[coach-final-stage] BLOCKED before step ${nextStep} (${nextLabel}) at ${location}`,
    {
      lastReachedStep: prev,
      lastReachedLabel: prevLabel,
      nextStep,
      nextLabel,
      reason,
      requestId: lastRequestId,
      ...meta,
    },
  );
}

export function traceFinalStageError(
  step: CoachFinalStageStep,
  location: string,
  err: unknown,
  meta?: Record<string, unknown>,
): void {
  console.error(`[coach-final-stage] ERROR at step ${step} (${STEP_NAMES[step]}) — ${location}`, {
    requestId: lastRequestId,
    ...meta,
    error: err instanceof Error ? { name: err.name, message: err.message, stack: err.stack } : err,
  });
  if (err instanceof Error && err.stack) {
    console.error(`[coach-final-stage] stack (${location}):\n${err.stack}`);
  }
}
