// Unified per-request pipeline operation tracing — one requestId start to finish.

export const COACH_PIPELINE_OP_LOG = "[coach-pipeline-op]";

export type CoachPipelineOpOutcome = "resolved" | "rejected" | "timed_out" | "cancelled";

export type CoachPipelineOpStage =
  | "request-send"
  | "injury-complete"
  | "pricing-started"
  | "ev-calculation"
  | "simulations"
  | "confidence-scoring"
  | "line-value-complete"
  | "correlation"
  | "finalize"
  | "delivery";

export type CoachPipelineOpRecord = {
  requestId: string;
  stage: CoachPipelineOpStage | string;
  fn: string;
  file: string;
  line: number;
  startedAt: number;
  finishedAt: number;
  durationMs: number;
  candidatesIn: number | null;
  candidatesOut: number | null;
  outcome: CoachPipelineOpOutcome;
  error: string | null;
};

const recordsByRequest = new Map<string, CoachPipelineOpRecord[]>();
const pendingByRequest = new Map<string, Set<string>>();

function logLine(message: string): void {
  console.log(`${COACH_PIPELINE_OP_LOG} ${message}`);
}

function captureStack(label: string): string {
  const err = new Error(label);
  return err.stack ?? label;
}

export function resetCoachPipelineOperationTraceForTests(): void {
  recordsByRequest.clear();
  pendingByRequest.clear();
}

export function getCoachPipelineOperationRecords(requestId: string): CoachPipelineOpRecord[] {
  return [...(recordsByRequest.get(requestId) ?? [])];
}

function formatRecord(r: CoachPipelineOpRecord): string {
  return [
    `requestId=${r.requestId}`,
    `stage=${r.stage}`,
    `fn=${r.fn}`,
    `file=${r.file}`,
    `line=${r.line}`,
    `start=${r.startedAt}`,
    `finish=${r.finishedAt}`,
    `durationMs=${r.durationMs}`,
    `candidatesIn=${r.candidatesIn ?? "—"}`,
    `candidatesOut=${r.candidatesOut ?? "—"}`,
    `outcome=${r.outcome}`,
    r.error ? `error=${r.error}` : null,
  ]
    .filter(Boolean)
    .join(" ");
}

function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const name = (err as { name?: string }).name;
  return name === "AbortError";
}

export async function traceCoachPipelineOperation<T>(opts: {
  requestId: string;
  stage: CoachPipelineOpStage | string;
  fn: string;
  file: string;
  line: number;
  candidatesIn?: number | null;
  run: () => Promise<T>;
  candidatesOut?: (result: T) => number | null;
  timeoutMs?: number;
  signal?: AbortSignal;
  onTimeout?: () => T | Promise<T>;
}): Promise<T> {
  const startedAt = Date.now();
  const pendingKey = `${opts.file}:${opts.line}:${opts.stage}`;
  const pending = pendingByRequest.get(opts.requestId) ?? new Set<string>();
  pending.add(pendingKey);
  pendingByRequest.set(opts.requestId, pending);

  logLine(`op-start ${formatRecord({
    requestId: opts.requestId,
    stage: opts.stage,
    fn: opts.fn,
    file: opts.file,
    line: opts.line,
    startedAt,
    finishedAt: startedAt,
    durationMs: 0,
    candidatesIn: opts.candidatesIn ?? null,
    candidatesOut: null,
    outcome: "resolved",
    error: null,
  })}`);

  const timeoutMs = opts.timeoutMs ?? 10_000;
  const useTimeout = timeoutMs > 0;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let timedOut = false;
  const blockingStack = captureStack(`await:${opts.stage}`);

  const finish = (
    outcome: CoachPipelineOpOutcome,
    error: string | null,
    finishedAt: number,
    candidatesOut: number | null,
  ): void => {
    pending.delete(pendingKey);
    const record: CoachPipelineOpRecord = {
      requestId: opts.requestId,
      stage: opts.stage,
      fn: opts.fn,
      file: opts.file,
      line: opts.line,
      startedAt,
      finishedAt,
      durationMs: finishedAt - startedAt,
      candidatesIn: opts.candidatesIn ?? null,
      candidatesOut,
      outcome,
      error,
    };
    const list = recordsByRequest.get(opts.requestId) ?? [];
    list.push(record);
    recordsByRequest.set(opts.requestId, list);
    logLine(`op-finish ${formatRecord(record)}`);
    if (outcome === "timed_out" || outcome === "rejected") {
      logLine(`op-blocking-stack requestId=${opts.requestId} stage=${opts.stage} ${blockingStack}`);
    }
  };

  try {
    if (opts.signal?.aborted) {
      finish("cancelled", "AbortError", Date.now(), null);
      const aborted = new Error("Aborted");
      aborted.name = "AbortError";
      throw aborted;
    }

    const result = await Promise.race([
      opts.run(),
      ...(useTimeout
        ? [
            new Promise<never>((_, reject) => {
              timeoutId = setTimeout(() => {
                timedOut = true;
                reject(new Error(`coach-pipeline-op-timeout:${opts.stage}`));
              }, timeoutMs);
            }),
          ]
        : []),
    ]);

    if (timeoutId) clearTimeout(timeoutId);
    const outCount = opts.candidatesOut?.(result) ?? null;
    finish("resolved", null, Date.now(), outCount);
    return result;
  } catch (err: unknown) {
    if (timeoutId) clearTimeout(timeoutId);
    const message = err instanceof Error ? err.message : String(err);
    if (timedOut || message.includes("coach-pipeline-op-timeout")) {
      finish("timed_out", message, Date.now(), null);
      if (opts.onTimeout) {
        const fallback = await opts.onTimeout();
        const outCount = opts.candidatesOut?.(fallback) ?? null;
        finish("resolved", "timeout-fallback", Date.now(), outCount);
        return fallback;
      }
      throw err;
    }
    if (isAbortError(err)) {
      finish("cancelled", message, Date.now(), null);
      throw err;
    }
    finish("rejected", message, Date.now(), null);
    throw err;
  }
}

export function logCoachPipelineOperationSummary(requestId: string): void {
  const records = getCoachPipelineOperationRecords(requestId);
  const pending = pendingByRequest.get(requestId);
  logLine(`── pipeline-op summary requestId=${requestId} ops=${records.length} pending=${pending?.size ?? 0} ──`);
  for (const r of records) {
    logLine(`  ${formatRecord(r)}`);
  }
  if (pending?.size) {
    for (const key of pending) {
      logLine(`  PENDING ${key}`);
    }
  }
}
