// Pipeline function entry/exit — grep: coach-pipeline-trace

export type CoachPipelineSnapshot = {
  activeRequestId: string | null;
  sendGeneration: number;
  scanComplete: boolean;
  pickCount: number;
  selectedCount: number;
  correlationRequestId: string | null;
  finalizedRequestId: string | null;
};

type CoachPipelineSink = () => CoachPipelineSnapshot;

let pipelineSink: CoachPipelineSink | null = null;

const EMPTY: CoachPipelineSnapshot = {
  activeRequestId: null,
  sendGeneration: 0,
  scanComplete: false,
  pickCount: 0,
  selectedCount: 0,
  correlationRequestId: null,
  finalizedRequestId: null,
};

export function registerCoachPipelineTraceSink(sink: CoachPipelineSink): () => void {
  pipelineSink = sink;
  return () => {
    if (pipelineSink === sink) pipelineSink = null;
  };
}

export function readCoachPipelineSnapshot(): CoachPipelineSnapshot {
  return pipelineSink?.() ?? EMPTY;
}

function snap(overrides?: Partial<CoachPipelineSnapshot>): CoachPipelineSnapshot {
  const base = readCoachPipelineSnapshot();
  if (!overrides) return base;
  const merged = { ...base };
  for (const [key, value] of Object.entries(overrides) as [keyof CoachPipelineSnapshot, unknown][]) {
    if (value !== undefined) merged[key] = value as never;
  }
  return merged;
}

export function tracePipelineEnter(
  fn: "runCorrelation" | "runFinalizeCoachTicket" | "commitCards",
  overrides?: Partial<CoachPipelineSnapshot> & Record<string, unknown>,
): void {
  const { ...extra } = overrides ?? {};
  console.log(`[coach-pipeline-trace] ${fn}-enter`, JSON.stringify({ ...snap(overrides), ...extra }));
}

export function tracePipelineExit(
  fn: "runCorrelation" | "runFinalizeCoachTicket" | "commitCards",
  overrides?: Partial<CoachPipelineSnapshot> & Record<string, unknown>,
): void {
  const { ...extra } = overrides ?? {};
  console.log(`[coach-pipeline-trace] ${fn}-exit`, JSON.stringify({ ...snap(overrides), ...extra }));
}

/** Log when a function is never called — name the gate that blocked entry. */
export function tracePipelineBlocked(
  fn: "runCorrelation" | "runFinalizeCoachTicket" | "commitCards",
  condition: string,
  overrides?: Partial<CoachPipelineSnapshot> & Record<string, unknown>,
): void {
  const { ...extra } = overrides ?? {};
  console.log(
    `[coach-pipeline-trace] ${fn}-blocked`,
    JSON.stringify({ condition, ...snap(overrides), ...extra }),
  );
}

export function resetCoachPipelineTraceForTests(): void {
  pipelineSink = null;
}
