/** Coach line-value / EV stage — bounded batches, soft timeout, structured tracing. */

import type { ParsedPick } from "../components/PickCard.tsx";
import type { PropPoolEntry, RealOddsEntry } from "./api.ts";
import type { CoachBuildProgressCallback } from "./coachBuildProgress.ts";
import { logCoachPipelineError, logCoachPipelineEvent } from "./coachPipelineTrace.ts";
import {
  coachScanPipelineIsStale,
  isCoachBackgroundScanRequestId,
  resolveCoachScanRequestId,
} from "./coachScanPipeline.ts";
import { attachPickScores } from "./pickScoreContext.ts";
import type { EvaluatedGameLine } from "./gameLineOptimizer.ts";

export const COACH_EV_TIMEOUT_MS = 15_000;
export const COACH_EV_CONCURRENCY = 6;
export const COACH_EV_BATCH_SIZE = 24;
export const COACH_EV_PROGRESS_INTERVAL_MS = 500;

export type CoachEvPropDuration = {
  index: number;
  durationMs: number;
  error?: string;
};

export type CoachEvStageStats = {
  inputCount: number;
  processedCount: number;
  successfulCount: number;
  rejectedCount: number;
  batchNumber: number;
  poolCap: number;
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

/** Cap EV candidates before expensive scoring — scales with leg target. */
export function coachEvPoolCap(target: number, poolSize: number): number {
  const scaled = Math.max(48, target * 16);
  return Math.min(poolSize, Math.min(160, scaled));
}

/** Minimum scored props before EV can early-exit (enough for a diversified ticket). */
export function coachEvQualifiedStopCount(target: number): number {
  return Math.max(target * 4, target + 8);
}

function cheapPropRank(pick: ParsedPick): number {
  const composite = pick.finalAiScore?.composite ?? pick.scores?.composite;
  if (composite != null) return composite;
  const odds = pick.odds ?? 0;
  return 100 - Math.min(Math.abs(odds), 100);
}

export function capCoachEvCandidates(
  picks: ParsedPick[],
  target: number,
): { capped: ParsedPick[]; poolCap: number } {
  const poolCap = coachEvPoolCap(target, picks.length);
  if (picks.length <= poolCap) return { capped: picks, poolCap };
  const capped = [...picks].sort((a, b) => cheapPropRank(b) - cheapPropRank(a)).slice(0, poolCap);
  return { capped, poolCap };
}

function propPoolLookupKey(
  game: string,
  player: string | undefined,
  side: string | undefined,
  line: number | null | undefined,
): string {
  return `${game}|${player ?? ""}|${side ?? ""}|${line ?? ""}`;
}

export function buildPropPoolIndex(propPool: PropPoolEntry[]): Map<string, PropPoolEntry> {
  const index = new Map<string, PropPoolEntry>();
  for (const entry of propPool) {
    const key = propPoolLookupKey(entry.game, entry.player, entry.side, entry.line);
    if (!index.has(key)) index.set(key, entry);
    const looseKey = propPoolLookupKey(entry.game, entry.player, entry.side, null);
    if (!index.has(looseKey)) index.set(looseKey, entry);
  }
  return index;
}

function countEvQualified(scored: ParsedPick[]): number {
  let n = 0;
  for (const pick of scored) {
    const composite = pick.finalAiScore?.composite ?? pick.scores?.composite ?? 0;
    if (pick.finalAiScore?.recommends || composite >= 52) n++;
  }
  return n;
}

function logEvEvent(
  tag: string,
  requestId: string,
  stats: CoachEvStageStats,
  elapsedMs: number,
  extra?: Record<string, unknown>,
): void {
  if (coachScanPipelineIsStale(requestId) && !isCoachBackgroundScanRequestId(requestId)) return;
  logCoachPipelineEvent(tag, {
    requestId,
    phase: "EV_CALCULATION",
    elapsedMs,
    candidateCount: stats.inputCount,
    processedCount: stats.processedCount,
    successfulCount: stats.successfulCount,
    rejectedCount: stats.rejectedCount,
    batchNumber: stats.batchNumber,
    poolCap: stats.poolCap,
    ...extra,
  });
}

export function logCoachScanEvStart(
  requestId: string,
  propCount: number,
  poolCap: number,
): void {
  const id = resolveCoachScanRequestId(requestId, "logCoachScanEvStart");
  logEvEvent(
    "[coach-scan] ev-start",
    id,
    {
      inputCount: propCount,
      processedCount: 0,
      successfulCount: 0,
      rejectedCount: 0,
      batchNumber: 0,
      poolCap,
    },
    0,
  );
}

function logCoachScanEvProgress(
  requestId: string,
  stats: CoachEvStageStats,
  elapsedMs: number,
): void {
  logEvEvent("[coach-scan] ev-progress", requestId, stats, elapsedMs);
}

export function logCoachScanEvComplete(
  requestId: string,
  stats: CoachEvStageStats,
  durationMs: number,
  timedOut: boolean,
  onProgress?: CoachBuildProgressCallback,
): void {
  const id = resolveCoachScanRequestId(requestId, "logCoachScanEvComplete");
  logEvEvent("[coach-scan] ev-complete", id, stats, durationMs, { timedOut });
  if (!coachScanPipelineIsStale(id) || isCoachBackgroundScanRequestId(id)) {
    onProgress?.("line-value", id);
  }
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

/** Log EV deadline — does NOT throw; pipeline continues with partial results. */
export function logCoachScanEvTimeout(
  requestId: string,
  stats: CoachEvStageStats,
  durationMs: number,
): void {
  const id = resolveCoachScanRequestId(requestId, "logCoachScanEvTimeout");
  logCoachPipelineError("[coach-scan] ev-timeout", {
    requestId: id,
    phase: "EV_CALCULATION",
    elapsedMs: durationMs,
    candidateCount: stats.inputCount,
    processedCount: stats.processedCount,
    successfulCount: stats.successfulCount,
    rejectedCount: stats.rejectedCount,
    batchNumber: stats.batchNumber,
    poolCap: stats.poolCap,
  });
  logCoachPipelineEvent("[coach-scan] ev-timeout-fallback", {
    requestId: id,
    phase: "EV_CALCULATION",
    elapsedMs: durationMs,
    candidateCount: stats.successfulCount,
    processedCount: stats.processedCount,
    successfulCount: stats.successfulCount,
    rejectedCount: stats.rejectedCount,
    batchNumber: stats.batchNumber,
    poolCap: stats.poolCap,
  });
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export type CoachEvPickScoreOpts = Parameters<typeof attachPickScores>[1] & {
  propPoolIndex?: Map<string, PropPoolEntry>;
};

function scoreBatch(
  batch: ParsedPick[],
  scoreOpts: CoachEvPickScoreOpts,
): ParsedPick[] {
  try {
    return attachPickScores(batch, scoreOpts);
  } catch {
    const out: ParsedPick[] = [];
    for (const pick of batch) {
      try {
        out.push(...attachPickScores([pick], scoreOpts));
      } catch {
        /* skip bad row */
      }
    }
    return out;
  }
}

/** Score props in bounded batches — soft timeout, early exit, no throw on deadline. */
export async function runCoachEvPropPrescore(
  picks: ParsedPick[],
  scoreOpts: CoachEvPickScoreOpts,
  opts: {
    requestId?: string;
    signal?: AbortSignal;
    onProgress?: CoachBuildProgressCallback;
    timeoutMs?: number;
    target?: number;
  },
): Promise<{
  scored: ParsedPick[];
  inputCount: number;
  outputCount: number;
  durationMs: number;
  propDurations: CoachEvPropDuration[];
  timedOut: boolean;
  stats: CoachEvStageStats;
}> {
  const start = Date.now();
  const requestId = resolveCoachScanRequestId(opts.requestId, "runCoachEvPropPrescore");
  const target = opts.target ?? 5;
  const { capped, poolCap } = capCoachEvCandidates(picks, target);
  const inputCount = picks.length;
  const deadlineAt = start + (opts.timeoutMs ?? COACH_EV_TIMEOUT_MS);
  const propDurations: CoachEvPropDuration[] = [];
  const scored: ParsedPick[] = [];
  const qualifiedStop = coachEvQualifiedStopCount(target);

  const cachedScoreOpts: CoachEvPickScoreOpts = {
    ...scoreOpts,
    propPoolIndex: scoreOpts.propPoolIndex ?? buildPropPoolIndex(scoreOpts.propPool ?? []),
  };

  const stats: CoachEvStageStats = {
    inputCount,
    processedCount: 0,
    successfulCount: 0,
    rejectedCount: 0,
    batchNumber: 0,
    poolCap,
  };

  logCoachScanEvStart(requestId, inputCount, poolCap);

  if (capped.length === 0) {
    const durationMs = Date.now() - start;
    logCoachScanEvComplete(requestId, stats, durationMs, false, opts.onProgress);
    return {
      scored,
      inputCount,
      outputCount: 0,
      durationMs,
      propDurations,
      timedOut: false,
      stats,
    };
  }

  let lastProgressLog = start;
  let timedOut = false;

  for (let offset = 0; offset < capped.length; ) {
    if (opts.signal?.aborted) break;
    if (Date.now() >= deadlineAt) {
      timedOut = true;
      break;
    }
    if (countEvQualified(scored) >= qualifiedStop) break;

    stats.batchNumber += 1;
    const batch = capped.slice(offset, offset + COACH_EV_BATCH_SIZE);
    offset += batch.length;
    const batchStart = Date.now();

    const batchScored = scoreBatch(batch, cachedScoreOpts);
    for (let i = 0; i < batch.length; i++) {
      const row = batchScored[i];
      stats.processedCount += 1;
      if (row?.finalAiScore || row?.scores) {
        stats.successfulCount += 1;
        scored.push(row);
      } else {
        stats.rejectedCount += 1;
      }
      propDurations.push({ index: stats.processedCount - 1, durationMs: Date.now() - batchStart });
    }

    const now = Date.now();
    if (now - lastProgressLog >= COACH_EV_PROGRESS_INTERVAL_MS) {
      logCoachScanEvProgress(requestId, { ...stats }, now - start);
      lastProgressLog = now;
    }

    await yieldToEventLoop();
  }

  if (stats.processedCount < capped.length && Date.now() >= deadlineAt) {
    timedOut = true;
  }

  const durationMs = Date.now() - start;

  if (timedOut) {
    logCoachScanEvTimeout(requestId, stats, durationMs);
  }

  logCoachScanEvProgress(requestId, { ...stats }, durationMs);
  logCoachScanEvComplete(requestId, stats, durationMs, timedOut, opts.onProgress);

  return {
    scored,
    inputCount,
    outputCount: scored.length,
    durationMs,
    propDurations,
    timedOut,
    stats,
  };
}

/** Evaluate posted game-line rungs with per-game error tolerance and soft stage timeout. */
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
  timedOut: boolean;
}> {
  const start = Date.now();
  const requestId = resolveCoachScanRequestId(opts.requestId, "runCoachEvGameLines");
  const inputCount = games.reduce((n, g) => n + (g.lines?.length ?? 0), 0);
  const deadlineAt = start + COACH_EV_TIMEOUT_MS;
  const propDurations: CoachEvPropDuration[] = [];
  const evaluated: EvaluatedGameLine[] = [];

  logCoachScanEvStart(requestId, inputCount, inputCount);

  if (!games.length) {
    const durationMs = Date.now() - start;
    const stats: CoachEvStageStats = {
      inputCount: 0,
      processedCount: 0,
      successfulCount: 0,
      rejectedCount: 0,
      batchNumber: 0,
      poolCap: 0,
    };
    logCoachScanEvComplete(requestId, stats, durationMs, false, opts.onProgress);
    return { evaluated, inputCount: 0, outputCount: 0, durationMs, propDurations, timedOut: false };
  }

  let completedGames = 0;
  let batchNumber = 0;
  let timedOut = false;

  for (const entry of games) {
    if (opts.signal?.aborted) break;
    if (Date.now() >= deadlineAt) {
      timedOut = true;
      break;
    }
    batchNumber += 1;
    const itemStart = Date.now();
    try {
      const rows = evaluate(entry.game, entry.lines);
      const durationMs = Date.now() - itemStart;
      propDurations.push({ index: completedGames, durationMs });
      if (rows.length) evaluated.push(...rows);
      completedGames += 1;
    } catch (err) {
      const durationMs = Date.now() - itemStart;
      const message = err instanceof Error ? err.message : String(err);
      propDurations.push({ index: completedGames, durationMs, error: message });
      logCoachPipelineError("[coach-scan] ev-error", {
        requestId,
        phase: "EV_CALCULATION",
        elapsedMs: durationMs,
        candidateCount: inputCount,
        game: entry.game,
        message,
      });
    }
    await yieldToEventLoop();
  }

  const durationMs = Date.now() - start;
  const stats: CoachEvStageStats = {
    inputCount,
    processedCount: completedGames,
    successfulCount: evaluated.length,
    rejectedCount: Math.max(0, completedGames - evaluated.length),
    batchNumber,
    poolCap: inputCount,
  };

  if (timedOut || (Date.now() >= deadlineAt && completedGames < games.length)) {
    timedOut = true;
    logCoachScanEvTimeout(requestId, stats, durationMs);
  }

  logCoachScanEvComplete(requestId, stats, durationMs, timedOut, opts.onProgress);

  return {
    evaluated,
    inputCount,
    outputCount: evaluated.length,
    durationMs,
    propDurations,
    timedOut,
  };
}
