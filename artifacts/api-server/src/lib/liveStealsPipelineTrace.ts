/** Stage-by-stage tracing for GET /api/sports/live-steals — counts + failure reasons. */

export type LiveStealsPipelineStage =
  | "1-scan-start"
  | "2-odds-api-fetch"
  | "3-games-filtered"
  | "4-game-markets-parsed"
  | "5-props-fetch"
  | "6-player-prop-markets"
  | "7-stolen-base-props"
  | "8-ev-candidates"
  | "9-ranked-picks";

export type LiveStealsStageRecord = {
  stage: LiveStealsPipelineStage;
  ok: boolean;
  count?: number;
  message?: string;
  error?: string;
  detail?: Record<string, unknown>;
};

const stages: LiveStealsStageRecord[] = [];
let failedStage: LiveStealsPipelineStage | null = null;
let failedError: string | null = null;

export function resetLiveStealsPipelineTrace(): void {
  stages.length = 0;
  failedStage = null;
  failedError = null;
}

export function liveStealsPipelineStages(): readonly LiveStealsStageRecord[] {
  return stages;
}

export function liveStealsPipelineFailure(): {
  stage: LiveStealsPipelineStage | null;
  error: string | null;
} {
  return { stage: failedStage, error: failedError };
}

function recordStage(record: LiveStealsStageRecord): void {
  stages.push(record);
  const payload = {
    stage: record.stage,
    ok: record.ok,
    count: record.count,
    message: record.message,
    error: record.error,
    detail: record.detail,
  };
  if (record.ok) {
    console.info(`[live-steals-pipeline] ${record.stage}`, JSON.stringify(payload));
  } else {
    console.error(`[live-steals-pipeline] STOP at ${record.stage}`, JSON.stringify(payload));
    if (!failedStage) {
      failedStage = record.stage;
      failedError = record.error ?? record.message ?? "unknown";
    }
  }
}

export function logLiveStealsStage(
  stage: LiveStealsPipelineStage,
  count: number,
  opts: { message?: string; detail?: Record<string, unknown> } = {},
): void {
  recordStage({ stage, ok: true, count, message: opts.message, detail: opts.detail });
}

export function failLiveStealsStage(
  stage: LiveStealsPipelineStage,
  err: unknown,
  opts: { count?: number; detail?: Record<string, unknown> } = {},
): never {
  const error = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : undefined;
  recordStage({
    stage,
    ok: false,
    count: opts.count,
    error,
    detail: { ...opts.detail, stack },
  });
  if (stack) {
    console.error(`[live-steals-pipeline] stack at ${stage}:\n${stack}`);
  }
  throw err instanceof Error ? err : new Error(error);
}
