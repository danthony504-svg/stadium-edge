/** Request-scoped lifecycle for Coach plain Q&A (non-parlay ticket builds). */

export type CoachAskLifecyclePhase =
  | "idle"
  | "context-loaded"
  | "value-calculation-start"
  | "value-calculation-success"
  | "value-calculation-error"
  | "response-received"
  | "assistant-message-committed"
  | "progress-complete";

/** Maps lifecycle phases to AnalysisProgress ask indices (index 6 = 80%). */
export const COACH_ASK_PHASE_INDEX: Record<CoachAskLifecyclePhase, number> = {
  idle: 1,
  "context-loaded": 5,
  "value-calculation-start": 6,
  "value-calculation-success": 7,
  "value-calculation-error": 6,
  "response-received": 7,
  "assistant-message-committed": 8,
  "progress-complete": 8,
};

export const COACH_ASK_VALUE_CALC_TIMEOUT_MS = 20_000;

export type CoachAskRequestState = {
  requestId: string;
  sendGeneration: number;
  phase: CoachAskLifecyclePhase;
  workflowIndex: number;
  answerVisible: boolean;
  valueCalcWatchdog: ReturnType<typeof setTimeout> | null;
};

let activeAsk: CoachAskRequestState | null = null;

export function beginCoachAskRequest(requestId: string, sendGeneration: number): CoachAskRequestState {
  cancelCoachAskRequest();
  activeAsk = {
    requestId,
    sendGeneration,
    phase: "idle",
    workflowIndex: 1,
    answerVisible: false,
    valueCalcWatchdog: null,
  };
  return activeAsk;
}

export function cancelCoachAskRequest(): void {
  if (activeAsk?.valueCalcWatchdog) clearTimeout(activeAsk.valueCalcWatchdog);
  activeAsk = null;
}

export function getActiveCoachAskRequest(): CoachAskRequestState | null {
  return activeAsk;
}

export function coachAskRequestMatches(requestId: string, sendGeneration: number): boolean {
  return (
    !!activeAsk &&
    activeAsk.requestId === requestId &&
    activeAsk.sendGeneration === sendGeneration
  );
}

function clearValueCalcWatchdog(): void {
  if (activeAsk?.valueCalcWatchdog) {
    clearTimeout(activeAsk.valueCalcWatchdog);
    activeAsk.valueCalcWatchdog = null;
  }
}

export function armCoachAskValueCalcWatchdog(
  requestId: string,
  sendGeneration: number,
  onTimeout: () => void,
  timeoutMs = COACH_ASK_VALUE_CALC_TIMEOUT_MS,
): boolean {
  if (!coachAskRequestMatches(requestId, sendGeneration) || !activeAsk) return false;
  clearValueCalcWatchdog();
  activeAsk.valueCalcWatchdog = setTimeout(() => {
    if (!coachAskRequestMatches(requestId, sendGeneration)) return;
    onTimeout();
  }, timeoutMs);
  return true;
}

export function setCoachAskLifecyclePhase(
  requestId: string,
  sendGeneration: number,
  phase: CoachAskLifecyclePhase,
  opts?: { answerVisible?: boolean },
): number | null {
  if (!coachAskRequestMatches(requestId, sendGeneration) || !activeAsk) return null;

  if (phase === "value-calculation-success" || phase === "value-calculation-error") {
    clearValueCalcWatchdog();
  }

  if (phase === "progress-complete" && !activeAsk.answerVisible) {
    return activeAsk.workflowIndex;
  }

  if (opts?.answerVisible) activeAsk.answerVisible = true;

  activeAsk.phase = phase;
  const idx = COACH_ASK_PHASE_INDEX[phase];
  if (idx > activeAsk.workflowIndex || phase === "value-calculation-error") {
    activeAsk.workflowIndex = idx;
  }
  return activeAsk.workflowIndex;
}

export function coachAskAnswerVisible(requestId: string, sendGeneration: number): boolean {
  if (!coachAskRequestMatches(requestId, sendGeneration) || !activeAsk) return false;
  return activeAsk.answerVisible;
}

export function coachAskWorkflowIndex(
  requestId: string,
  sendGeneration: number,
): number | undefined {
  if (!coachAskRequestMatches(requestId, sendGeneration) || !activeAsk) return undefined;
  return activeAsk.workflowIndex;
}

export class CoachAskValueCalcError extends Error {
  readonly timedOut: boolean;
  constructor(message: string, timedOut = false) {
    super(message);
    this.name = "CoachAskValueCalcError";
    this.timedOut = timedOut;
  }
}

export async function withCoachAskValueCalcTimeout<T>(
  work: Promise<T>,
  timeoutMs = COACH_ASK_VALUE_CALC_TIMEOUT_MS,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new CoachAskValueCalcError(
                "Value calculation timed out — live prop scoring took too long. Tap Try again.",
                true,
              ),
            ),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Drop assistant rows from superseded failed or in-flight Q&A requests. */
export function isSupersededCoachQaAssistant(m: {
  role: string;
  content?: string;
  retry?: string;
  parlayBuild?: boolean;
  picks?: unknown[];
  analyzeSlip?: unknown[];
  statCard?: unknown;
  periodGameLog?: unknown;
  teamCard?: unknown;
}): boolean {
  if (m.role !== "assistant") return false;
  if (m.parlayBuild || m.picks?.length || m.analyzeSlip?.length) return false;
  if (m.statCard || m.periodGameLog || m.teamCard) return false;
  if (m.retry) return true;
  return !`${m.content ?? ""}`.trim();
}
