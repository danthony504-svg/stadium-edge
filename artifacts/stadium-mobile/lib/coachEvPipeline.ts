/** Coach line-value / EV stage — bounded concurrency, timeouts, tracing. */

import type { ParsedPick } from "../components/PickCard.tsx";
import type { RealOddsEntry } from "./api.ts";
import type { CoachBuildProgressCallback } from "./coachBuildProgress.ts";
import { logCoachPipelineError, logCoachPipelineEvent } from "./coachPipelineTrace.ts";
import {
  coachScanPipelineIsStale,
  resolveCoachScanRequestId,
} from "./coachScanPipeline.ts";
import { attachPickScores } from "./pickScoreContext.ts";
import type { EvaluatedGameLine } from "./gameLineOptimizer.ts";

export const COACH_EV_TIMEOUT_MS = 15_000;
export const COACH_EV_CONCURRENCY = 6;

export type CoachEvPropDuration = {
  index: number;
  durationMs: number;
  error?: string;
};

export class CoachEvStageError extends Error {
  readonly requestId: string;
  readonly durationMs: number;
  readonly timedOut: boolean;

  constructor(
    message: string,
    opts: {
      requestId: string;
      durationMs: number;
      timedOut?: boolean;
      cause?: unknown;
    },
  ) {
    super(message, opts.cause != null ? { cause: opts.cause } : undefined);
    this.name = "CoachEvStageError";
    this.requestId = opts.requestId;
    this.durationMs = opts.durationMs;
    this.timedOut = opts.timedOut === true;
  }
}

export function logCoachScanEvStart(requestId: string, propCount: number): void {
  const id = resolveCoachScanRequestId(requestId, "logCoachScanEvStart");
  if (coachScanPipelineIsStale(id)) return;
  logCoachPipelineEvent("[coach-scan] ev-start", {
    requestId: id,
    phase: "EV_CALCULATION",
    elapsedMs: 0,
    candidateCount: propCount,
  });
}

export function logCoachScanEvProgress(
  requestId: string,
  completed: number,
  total: number,
  lastDurationMs?: number,
): void {
  const id = resolveCoachScanRequestId(requestId, "logCoachScanEvProgress");
  if (coachScanPipelineIsStale(id)) return;
  logCoachPipelineEvent("[coach-scan] ev-progress", {
    requestId: id,
    phase: "EV_CALCULATION",
    elapsedMs: lastDurationMs ?? 0,
    candidateCount: total,
    completed,
    total,
  });
}

export function logCoachScanEvComplete(
  requestId: string,
  inputCount: number,
  outputCount: number,
  durationMs: number,
  propDurations: CoachEvPropDuration[],
  onProgress?: CoachBuildProgressCallback,
): void {
  const id = resolveCoachScanRequestId(requestId, "logCoachScanEvComplete");
  if (coachScanPipelineIsStale(id)) return;
  logCoachPipelineEvent("[coach-scan] ev-complete", {
    requestId: id,
    phase: "EV_CALCULATION",
    elapsedMs: durationMs,
    candidateCount: inputCount,
    inputCount,
    outputCount,
    propDurations,
  });
  onProgress?.("line-value", id);
}

export function logCoachScanEvError(
  requestId: string,
  message: string,
  durationMs: number,
  stack?: string,
): never {
  const id = resolveCoachScanRequestId(requestId, "logCoachScanEvError");
  logCoachPipelineError("[coach-scan] ev-error", {
    requestId: id,
    phase: "EV_CALCULATION",
    elapsedMs: durationMs,
    message,
  });
  if (stack) console.error(stack);
  throw new CoachEvStageError(message, { requestId: id, durationMs });
}

export function logCoachScanEvTimeout(requestId: string, durationMs: number): never {
  const id = resolveCoachScanRequestId(requestId, "logCoachScanEvTimeout");
  logCoachPipelineError("[coach-scan] ev-timeout", {
    requestId: id,
    phase: "EV_CALCULATION",
    elapsedMs: durationMs,
  });
  throw new CoachEvStageError(`EV calculation timed out after ${durationMs}ms`, {
    requestId: id,
    durationMs,
    timedOut: true,
  });
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  deadlineAt: number,
  fn: (item: T, index: number) => Promise<R>,
  onEach?: (index: number, durationMs: number) => void,
): Promise<R[]> {
  if (!items.length) return [];
  const results: R[] = new Array(items.length);
  let next = 0;
  let completed = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      if (Date.now() >= deadlineAt) break;
      const idx = next++;
      if (idx >= items.length) break;
      const itemStart = Date.now();
      results[idx] = await fn(items[idx]!, idx);
      const durationMs = Date.now() - itemStart;
      completed += 1;
      onEach?.(completed, durationMs);
      if (completed % COACH_EV_CONCURRENCY === 0) {
        await yieldToEventLoop();
      }
    }
  });
  await Promise.all(workers);
  return results;
}

export type CoachEvPickScoreOpts = Parameters<typeof attachPickScores>[1];

/** Score props one-at-a-time with bounded concurrency — skips bad rows instead of aborting. */
export async function runCoachEvPropPrescore(
  picks: ParsedPick[],
  scoreOpts: CoachEvPickScoreOpts,
  opts: {
    requestId?: string;
    signal?: AbortSignal;
    onProgress?: CoachBuildProgressCallback;
    timeoutMs?: number;
  },
): Promise<{
  scored: ParsedPick[];
  inputCount: number;
  outputCount: number;
  durationMs: number;
  propDurations: CoachEvPropDuration[];
  timedOut: boolean;
}> {
  const start = Date.now();
  const requestId = resolveCoachScanRequestId(opts.requestId, "runCoachEvPropPrescore");
  const inputCount = picks.length;
  const deadlineAt = start + (opts.timeoutMs ?? COACH_EV_TIMEOUT_MS);
  const propDurations: CoachEvPropDuration[] = [];
  const scored: ParsedPick[] = [];

  logCoachScanEvStart(requestId, inputCount);

  if (inputCount === 0) {
    const durationMs = Date.now() - start;
    logCoachScanEvComplete(requestId, 0, 0, durationMs, propDurations, opts.onProgress);
    return { scored, inputCount: 0, outputCount: 0, durationMs, propDurations, timedOut: false };
  }

  let completed = 0;
  const results = await mapWithConcurrency(
    picks,
    COACH_EV_CONCURRENCY,
    deadlineAt,
    async (pick, index) => {
      if (opts.signal?.aborted) return null;
      const itemStart = Date.now();
      try {
        const [row] = attachPickScores([pick], scoreOpts);
        const durationMs = Date.now() - itemStart;
        propDurations.push({ index, durationMs });
        return row ?? null;
      } catch (err) {
        const durationMs = Date.now() - itemStart;
        const message = err instanceof Error ? err.message : String(err);
        const stack = err instanceof Error ? err.stack : undefined;
        propDurations.push({ index, durationMs, error: message });
        logCoachPipelineError("[coach-scan] ev-error", {
          requestId,
          phase: "EV_CALCULATION",
          elapsedMs: durationMs,
          candidateCount: inputCount,
          index,
          message,
        });
        if (stack) console.error(stack);
        return null;
      }
    },
    (count, lastDurationMs) => {
      completed = count;
      logCoachScanEvProgress(requestId, completed, inputCount, lastDurationMs);
    },
  );

  for (const row of results) {
    if (row) scored.push(row);
  }

  const durationMs = Date.now() - start;
  const timedOut = Date.now() >= deadlineAt && completed < inputCount;

  if (timedOut) {
    logCoachScanEvTimeout(requestId, durationMs);
  }

  logCoachScanEvComplete(
    requestId,
    inputCount,
    scored.length,
    durationMs,
    propDurations,
    opts.onProgress,
  );

  return {
    scored,
    inputCount,
    outputCount: scored.length,
    durationMs,
    propDurations,
    timedOut: false,
  };
}

/** Evaluate posted game-line rungs with per-game error tolerance and stage timeout. */
export async function runCoachEvGameLines(
  games: { game: string; lines: RealOddsEntry[] }[],
  evaluate: (game: string, lines: RealOddsEntry[]) => EvaluatedGameLine[],
  opts: {
    requestId?: string;
    signal?: AbortSignal;
    onProgress?: CoachBuildProgressCallback;
  },
): Promise<{
  evaluated: EvaluatedGameLine[];
  inputCount: number;
  outputCount: number;
  durationMs: number;
  propDurations: CoachEvPropDuration[];
}> {
  const start = Date.now();
  const requestId = resolveCoachScanRequestId(opts.requestId, "runCoachEvGameLines");
  const inputCount = games.reduce((n, g) => n + (g.lines?.length ?? 0), 0);
  const deadlineAt = start + COACH_EV_TIMEOUT_MS;
  const propDurations: CoachEvPropDuration[] = [];
  const evaluated: EvaluatedGameLine[] = [];

  logCoachScanEvStart(requestId, inputCount);

  if (!games.length) {
    const durationMs = Date.now() - start;
    logCoachScanEvComplete(requestId, 0, 0, durationMs, propDurations, opts.onProgress);
    return { evaluated, inputCount: 0, outputCount: 0, durationMs, propDurations };
  }

  let completedGames = 0;
  await mapWithConcurrency(
    games,
    Math.min(4, COACH_EV_CONCURRENCY),
    deadlineAt,
    async (entry, index) => {
      if (opts.signal?.aborted) return null;
      const itemStart = Date.now();
      try {
        const rows = evaluate(entry.game, entry.lines);
        const durationMs = Date.now() - itemStart;
        propDurations.push({ index, durationMs });
        return rows;
      } catch (err) {
        const durationMs = Date.now() - itemStart;
        const message = err instanceof Error ? err.message : String(err);
        propDurations.push({ index, durationMs, error: message });
        logCoachPipelineError("[coach-scan] ev-error", {
          requestId,
          phase: "EV_CALCULATION",
          elapsedMs: durationMs,
          candidateCount: inputCount,
          game: entry.game,
          message,
        });
        return null;
      }
    },
    (count, lastDurationMs) => {
      completedGames = count;
      logCoachScanEvProgress(requestId, completedGames, games.length, lastDurationMs);
    },
  ).then((rows) => {
    for (const batch of rows) {
      if (batch?.length) evaluated.push(...batch);
    }
  });

  const durationMs = Date.now() - start;
  const timedOut = Date.now() >= deadlineAt && completedGames < games.length;

  if (timedOut) {
    logCoachScanEvTimeout(requestId, durationMs);
  }

  logCoachScanEvComplete(
    requestId,
    inputCount,
    evaluated.length,
    durationMs,
    propDurations,
    opts.onProgress,
  );

  return {
    evaluated,
    inputCount,
    outputCount: evaluated.length,
    durationMs,
    propDurations,
  };
}
