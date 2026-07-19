/** Request-scoped workflow for plain Coach Q&A (non-parlay, non-analyze). */

export type CoachAskStage =
  | "question-understood"
  | "live-data-pulled"
  | "key-factors-identified"
  | "value-calc-started"
  | "value-calc-completed"
  | "answer-committed"
  | "answer-ready";

/** Maps to AnalysisProgress ASK_STAGES / ASK_TARGETS indices. */
export const COACH_ASK_WORKFLOW_INDEX: Record<CoachAskStage, number> = {
  "question-understood": 1,
  "live-data-pulled": 4,
  "key-factors-identified": 5,
  "value-calc-started": 6,
  "value-calc-completed": 7,
  "answer-committed": 8,
  "answer-ready": 8,
};

/** Wall clock for prop scoring / sim selection during ask. */
export const COACH_ASK_VALUE_CALC_TIMEOUT_MS = 45_000;

export type CoachAskRequestState = {
  requestId: string;
  sendGeneration: number;
  workflowIndex: number;
  valueCalcStarted: boolean;
  answerCommitted: boolean;
  answerReady: boolean;
};

let activeAsk: CoachAskRequestState | null = null;

export function beginCoachAskRequest(requestId: string, sendGeneration: number): CoachAskRequestState {
  activeAsk = {
    requestId,
    sendGeneration,
    workflowIndex: 0,
    valueCalcStarted: false,
    answerCommitted: false,
    answerReady: false,
  };
  return activeAsk;
}

export function clearCoachAskRequest(): void {
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

export function advanceCoachAskStage(
  requestId: string,
  sendGeneration: number,
  stage: CoachAskStage,
): number | null {
  if (!coachAskRequestMatches(requestId, sendGeneration) || !activeAsk) return null;
  const idx = COACH_ASK_WORKFLOW_INDEX[stage];
  if (stage === "value-calc-started") activeAsk.valueCalcStarted = true;
  if (stage === "answer-committed") activeAsk.answerCommitted = true;
  if (stage === "answer-ready") {
    if (!activeAsk.answerCommitted) return activeAsk.workflowIndex;
    activeAsk.answerReady = true;
  }
  if (idx > activeAsk.workflowIndex) activeAsk.workflowIndex = idx;
  return activeAsk.workflowIndex;
}

export function coachAskAnswerCommitted(requestId: string, sendGeneration: number): boolean {
  if (!coachAskRequestMatches(requestId, sendGeneration) || !activeAsk) return false;
  return activeAsk.answerCommitted;
}

export function coachAskAnswerReady(requestId: string, sendGeneration: number): boolean {
  if (!coachAskRequestMatches(requestId, sendGeneration) || !activeAsk) return false;
  return activeAsk.answerReady;
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
                "Value calculation timed out — live prop scoring took too long.",
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
