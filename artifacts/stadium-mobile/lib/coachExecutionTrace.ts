// Exact Coach handoff execution trace — grep: coach-exec-trace

export type CoachExecStep =
  | "board-scan-complete"
  | "correlation-start"
  | "correlation-complete"
  | "finalizeCoachTicket-entry"
  | "finalizeCoachTicket-exit"
  | "commit-start"
  | "commit-cards-applied"
  | "commit-complete";

export type CoachExecSnapshot = {
  activeRequestId: string | null;
  scanComplete: boolean;
  pickCount: number;
  selectedCount: number;
  finalizedRequestId: string | null;
  correlationRequestId: string | null;
  sendGeneration: number;
};

type CoachExecSink = () => CoachExecSnapshot;

let execSink: CoachExecSink | null = null;

const EMPTY_SNAPSHOT: CoachExecSnapshot = {
  activeRequestId: null,
  scanComplete: false,
  pickCount: 0,
  selectedCount: 0,
  finalizedRequestId: null,
  correlationRequestId: null,
  sendGeneration: 0,
};

/** Coach screen registers ref-backed snapshot reader once on mount. */
export function registerCoachExecTraceSink(sink: CoachExecSink): () => void {
  execSink = sink;
  return () => {
    if (execSink === sink) execSink = null;
  };
}

export function readCoachExecSnapshot(): CoachExecSnapshot {
  return execSink?.() ?? EMPTY_SNAPSHOT;
}

function mergeSnapshot(overrides?: Partial<CoachExecSnapshot>): CoachExecSnapshot {
  const base = readCoachExecSnapshot();
  if (!overrides) return base;
  const merged = { ...base };
  for (const [key, value] of Object.entries(overrides) as [keyof CoachExecSnapshot, unknown][]) {
    if (value !== undefined) {
      merged[key] = value as never;
    }
  }
  return merged;
}

/** Log a pipeline step with the standard request snapshot fields. */
export function logCoachExecStep(
  step: CoachExecStep,
  overrides?: Partial<CoachExecSnapshot> & Record<string, unknown>,
): void {
  const snap = mergeSnapshot(overrides);
  console.log(`[coach-exec-trace] ${step}`, JSON.stringify({ ...snap, ...(overrides ?? {}) }));
}

/** Log when a step is skipped and name the gate that blocked it. */
export function logCoachExecSkip(
  step: CoachExecStep,
  condition: string,
  overrides?: Partial<CoachExecSnapshot> & Record<string, unknown>,
): void {
  const snap = mergeSnapshot(overrides);
  console.log(
    `[coach-exec-trace] ${step}-skipped`,
    JSON.stringify({ condition, ...snap, ...(overrides ?? {}) }),
  );
}

/** Reset sink for unit tests. */
export function resetCoachExecTraceForTests(): void {
  execSink = null;
}
