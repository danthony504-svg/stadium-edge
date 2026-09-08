// Coach run tracing — one requestId from button press through rendered pick cards.

export type CoachRunStage =
  | "request-start"
  | "odds-loaded"
  | "candidates-created"
  | "quality-filtered"
  | "deduped"
  | "simulations-complete"
  | "correlation-complete"
  | "correlation-skipped"
  | "final-selection"
  | "message-created"
  | "render-complete"
  | "terminal-no-markets"
  | "terminal-error"
  | "terminal-timeout";

export type CoachRunTerminal =
  | "building"
  | "success"
  | "no-markets"
  | "error"
  | "timeout";

let activeRequestId = "";
let activeTerminal: CoachRunTerminal = "building";

export function beginCoachRun(requestId: string, requestedLegs: number): void {
  activeRequestId = requestId;
  activeTerminal = "building";
  logCoachRun("request-start", { requestId, requestedLegs });
}

export function isActiveCoachRun(requestId: string | null | undefined): boolean {
  return !!requestId && requestId === activeRequestId;
}

export function coachRunTerminal(): CoachRunTerminal {
  return activeTerminal;
}

export function setCoachRunTerminal(
  terminal: CoachRunTerminal,
  requestId?: string | null,
): void {
  if (requestId && !isActiveCoachRun(requestId)) return;
  activeTerminal = terminal;
}

export function logCoachRun(
  stage: CoachRunStage,
  payload: Record<string, unknown> & { requestId?: string | null },
): boolean {
  const requestId = payload.requestId ?? activeRequestId;
  const stale = !!requestId && !!activeRequestId && requestId !== activeRequestId;
  console.log(
    `[coach-run] ${stage}`,
    JSON.stringify({
      requestId,
      ...(stale ? { stale: true, activeRequestId } : {}),
      ...payload,
    }),
  );
  return !stale;
}

/** Reset for unit tests. */
export function resetCoachRunTraceForTests(): void {
  activeRequestId = "";
  activeTerminal = "building";
}

export function activeCoachRequestId(): string {
  return activeRequestId;
}
