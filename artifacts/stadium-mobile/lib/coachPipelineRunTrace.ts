// Per-request Coach pipeline run tracing — one requestId from send through delivery.
// Backend diagnostics only (no UI). Every stage logs start/finish, duration, counts,
// success/failure, timeout, cancellation, and exceptions. Stages exceeding 10s capture
// a stack trace and fail gracefully instead of hanging progress.

export const COACH_PIPELINE_RUN_LOG = "[coach-pipeline-run]";

export const COACH_PIPELINE_STAGE_TIMEOUT_MS = 10_000;

export type CoachPipelineRunStage =
  | "request-send"
  | "context-fetch"
  | "injuries"
  | "board-scan-feeds"
  | "board-scan-games"
  | "board-scan-props"
  | "board-scan-sim"
  | "line-value"
  | "correlation"
  | "finalize"
  | "delivery"
  | "await-pending-scans"
  | "build-complete";

export type CoachPipelineStageOutcome = {
  success: boolean;
  candidatesOut?: number;
  exception?: string | null;
  timeout?: boolean;
  promiseCancelled?: boolean;
  blockingAwait?: string;
  blockingStack?: string;
};

export type CoachPipelineStageRecord = {
  requestId: string;
  sendGeneration: number;
  stage: CoachPipelineRunStage;
  startedAt: number;
  finishedAt: number;
  durationMs: number;
  success: boolean;
  exception: string | null;
  timeout: boolean;
  promiseCancelled: boolean;
  candidatesIn: number | null;
  candidatesOut: number | null;
  blockingAwait: string | null;
  blockingStack: string | null;
};

export type CoachPipelineRunSnapshot = {
  requestId: string;
  sendGeneration: number;
  startedAt: number;
  finishedAt: number | null;
  superseded: boolean;
  stages: CoachPipelineStageRecord[];
};

export class CoachPipelineStageTimeoutError extends Error {
  readonly requestId: string;
  readonly stage: CoachPipelineRunStage;
  readonly blockingStack: string;

  constructor(requestId: string, stage: CoachPipelineRunStage, blockingStack: string) {
    super(`coach-pipeline-stage-timeout:${stage}`);
    this.name = "CoachPipelineStageTimeoutError";
    this.requestId = requestId;
    this.stage = stage;
    this.blockingStack = blockingStack;
  }
}

type ActiveRun = {
  requestId: string;
  sendGeneration: number;
  startedAt: number;
  superseded: boolean;
  stages: CoachPipelineStageRecord[];
};

let activeRun: ActiveRun | null = null;
const runsById = new Map<string, ActiveRun>();

function logLine(message: string): void {
  console.log(`${COACH_PIPELINE_RUN_LOG} ${message}`);
}

function captureStack(label: string): string {
  const err = new Error(label);
  return err.stack ?? label;
}

function formatStageRecord(r: CoachPipelineStageRecord): string {
  return [
    `requestId=${r.requestId}`,
    `stage=${r.stage}`,
    `start=${r.startedAt}`,
    `finish=${r.finishedAt}`,
    `durationMs=${r.durationMs}`,
    `success=${r.success}`,
    `exception=${r.exception ?? "—"}`,
    `timeout=${r.timeout}`,
    `cancelled=${r.promiseCancelled}`,
    `candidatesIn=${r.candidatesIn ?? "—"}`,
    `candidatesOut=${r.candidatesOut ?? "—"}`,
    r.blockingAwait ? `blockingAwait=${r.blockingAwait}` : null,
  ]
    .filter(Boolean)
    .join(" ");
}

export function resetCoachPipelineRunTraceForTests(): void {
  activeRun = null;
  runsById.clear();
}

export function beginCoachPipelineRun(requestId: string, sendGeneration: number): void {
  if (activeRun && !activeRun.superseded) {
    activeRun.superseded = true;
    logLine(
      `superseded requestId=${activeRun.requestId} sendGeneration=${activeRun.sendGeneration} by requestId=${requestId}`,
    );
  }
  const run: ActiveRun = {
    requestId,
    sendGeneration,
    startedAt: Date.now(),
    superseded: false,
    stages: [],
  };
  activeRun = run;
  runsById.set(requestId, run);
  logLine(`run-start requestId=${requestId} sendGeneration=${sendGeneration} t=${run.startedAt}`);
}

export function supersedeCoachPipelineRun(nextRequestId: string, nextSendGeneration: number): string | null {
  const priorId = activeRun?.requestId ?? null;
  if (activeRun) activeRun.superseded = true;
  beginCoachPipelineRun(nextRequestId, nextSendGeneration);
  return priorId;
}

export function coachPipelineRunIsActive(
  requestId: string,
  sendGeneration?: number,
): boolean {
  if (!activeRun || activeRun.superseded) return false;
  if (activeRun.requestId !== requestId) return false;
  if (sendGeneration != null && activeRun.sendGeneration !== sendGeneration) return false;
  return true;
}

export function getCoachPipelineRunSnapshot(
  requestId: string,
): CoachPipelineRunSnapshot | null {
  const run = runsById.get(requestId);
  if (!run) return null;
  return {
    requestId: run.requestId,
    sendGeneration: run.sendGeneration,
    startedAt: run.startedAt,
    finishedAt: run.stages.at(-1)?.finishedAt ?? null,
    superseded: run.superseded,
    stages: [...run.stages],
  };
}

export function finishCoachPipelineRun(
  requestId: string,
  outcome: { success: boolean; exception?: string | null },
): void {
  const run = runsById.get(requestId);
  if (!run) return;
  const finishedAt = Date.now();
  logLine(
    `run-finish requestId=${requestId} sendGeneration=${run.sendGeneration} success=${outcome.success} elapsedMs=${finishedAt - run.startedAt}${outcome.exception ? ` exception=${outcome.exception}` : ""}`,
  );
  if (activeRun?.requestId === requestId) activeRun = null;
}

export type CoachPipelineStageHandle = {
  requestId: string;
  sendGeneration: number;
  stage: CoachPipelineRunStage;
  startedAt: number;
  candidatesIn: number | null;
  watchdog: ReturnType<typeof setTimeout> | null;
};

export function beginCoachPipelineStage(
  requestId: string,
  sendGeneration: number,
  stage: CoachPipelineRunStage,
  candidatesIn?: number | null,
): CoachPipelineStageHandle {
  const startedAt = Date.now();
  logLine(
    `stage-start ${formatStageRecord({
      requestId,
      sendGeneration,
      stage,
      startedAt,
      finishedAt: startedAt,
      durationMs: 0,
      success: false,
      exception: null,
      timeout: false,
      promiseCancelled: false,
      candidatesIn: candidatesIn ?? null,
      candidatesOut: null,
      blockingAwait: null,
      blockingStack: null,
    })}`,
  );

  const handle: CoachPipelineStageHandle = {
    requestId,
    sendGeneration,
    stage,
    startedAt,
    candidatesIn: candidatesIn ?? null,
    watchdog: null,
  };

  handle.watchdog = setTimeout(() => {
    const stack = captureStack(`stage-watchdog:${stage}`);
    logLine(
      `stage-WATCHDOG requestId=${requestId} stage=${stage} exceeded=${COACH_PIPELINE_STAGE_TIMEOUT_MS}ms stack=${JSON.stringify(stack)}`,
    );
  }, COACH_PIPELINE_STAGE_TIMEOUT_MS);

  return handle;
}

export function endCoachPipelineStage(
  handle: CoachPipelineStageHandle,
  outcome: CoachPipelineStageOutcome,
): CoachPipelineStageRecord {
  if (handle.watchdog) clearTimeout(handle.watchdog);
  const finishedAt = Date.now();
  const durationMs = finishedAt - handle.startedAt;
  const record: CoachPipelineStageRecord = {
    requestId: handle.requestId,
    sendGeneration: handle.sendGeneration,
    stage: handle.stage,
    startedAt: handle.startedAt,
    finishedAt,
    durationMs,
    success: outcome.success,
    exception: outcome.exception ?? null,
    timeout: !!outcome.timeout,
    promiseCancelled: !!outcome.promiseCancelled,
    candidatesIn: handle.candidatesIn,
    candidatesOut: outcome.candidatesOut ?? null,
    blockingAwait: outcome.blockingAwait ?? null,
    blockingStack: outcome.blockingStack ?? null,
  };
  const run = runsById.get(handle.requestId);
  if (run) run.stages.push(record);
  logLine(`stage-finish ${formatStageRecord(record)}`);
  if (outcome.blockingStack) {
    logLine(`stage-blocking-stack requestId=${handle.requestId} stage=${handle.stage} ${outcome.blockingStack}`);
  }
  return record;
}

function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const name = (err as { name?: string }).name;
  return name === "AbortError" || name === "CoachPipelineStageTimeoutError";
}

/** Race `fn()` against a hard stage timeout; capture stack and throw on exceed. */
export async function withCoachPipelineStage<T>(
  requestId: string,
  sendGeneration: number,
  stage: CoachPipelineRunStage,
  candidatesIn: number | null | undefined,
  fn: () => Promise<T>,
  opts?: {
    timeoutMs?: number;
    candidatesOut?: (result: T) => number | null | undefined;
    blockingAwait?: string;
  },
): Promise<T> {
  const handle = beginCoachPipelineStage(requestId, sendGeneration, stage, candidatesIn);
  const timeoutMs = opts?.timeoutMs ?? COACH_PIPELINE_STAGE_TIMEOUT_MS;
  const blockingAwait = opts?.blockingAwait ?? stage;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let timedOut = false;
  const blockingStack = captureStack(`await:${blockingAwait}`);

  try {
    const result = await Promise.race([
      fn(),
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          timedOut = true;
          reject(
            new CoachPipelineStageTimeoutError(requestId, stage, blockingStack),
          );
        }, timeoutMs);
      }),
    ]);
    if (timeoutId) clearTimeout(timeoutId);
    endCoachPipelineStage(handle, {
      success: true,
      candidatesOut: opts?.candidatesOut?.(result) ?? null,
    });
    return result;
  } catch (err: unknown) {
    if (timeoutId) clearTimeout(timeoutId);
    const aborted = isAbortError(err) && !timedOut;
    const timeout = timedOut || err instanceof CoachPipelineStageTimeoutError;
    const message = err instanceof Error ? err.message : String(err);
    endCoachPipelineStage(handle, {
      success: false,
      exception: message,
      timeout,
      promiseCancelled: aborted,
      blockingAwait,
      blockingStack: timeout ? blockingStack : null,
    });
    throw err;
  }
}

/** Wrap an existing promise with stage tracing (no extra timeout — caller may use withCoachPipelineStage). */
export async function traceCoachPipelineAwait<T>(
  requestId: string,
  sendGeneration: number,
  stage: CoachPipelineRunStage,
  candidatesIn: number | null | undefined,
  promise: Promise<T>,
  opts?: {
    candidatesOut?: (result: T) => number | null | undefined;
    blockingAwait?: string;
  },
): Promise<T> {
  return withCoachPipelineStage(
    requestId,
    sendGeneration,
    stage,
    candidatesIn,
    () => promise,
    opts,
  );
}

export function logCoachPipelineRunSummary(requestId: string): void {
  const snap = getCoachPipelineRunSnapshot(requestId);
  if (!snap) return;
  logLine(`── pipeline summary requestId=${requestId} stages=${snap.stages.length} superseded=${snap.superseded} ──`);
  for (const s of snap.stages) {
    logLine(`  ${formatStageRecord(s)}`);
  }
}
