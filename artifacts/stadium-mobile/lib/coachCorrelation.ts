// Coach parlay correlation — bounded greedy selection with hard timeout and fallback.

import type { ParsedPick } from "../components/PickCard.ts";
import { tracePipelineEnter, tracePipelineExit } from "./coachPipelineTrace.ts";
import { parlayCorrelationPenalty } from "./parlayCorrelationScore.ts";
import { pickLegFingerprint } from "./parlayReachCore.ts";

export const COACH_CORRELATION_TIMEOUT_MS = 5000;

export type CoachCorrelationOutcome =
  | "completed"
  | "timeout-fallback"
  | "error-fallback"
  | "empty";

export type CoachCorrelationInput = {
  requestId: string;
  candidates: readonly ParsedPick[];
  requestedLegs: number;
};

export type CoachCorrelationResult = {
  requestId: string;
  requestedLegs: number;
  inputCount: number;
  outputCount: number;
  durationMs: number;
  outcome: CoachCorrelationOutcome;
  picks: ParsedPick[];
};

const completedRequestIds = new Set<string>();
const inFlight = new Map<string, Promise<CoachCorrelationResult>>();

export function resetCoachCorrelationForTests(): void {
  completedRequestIds.clear();
  inFlight.clear();
}

export function maxCorrelationCandidates(requestedLegs: number): number {
  if (requestedLegs <= 3) return 12;
  if (requestedLegs <= 5) return 20;
  if (requestedLegs <= 9) return 30;
  return 40;
}

function normGame(game: string): string {
  return String(game ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9@]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function rankScore(pick: ParsedPick): number {
  const score = pick.finalAiScore ?? pick.scores;
  const composite = score?.composite ?? 0;
  const edge = score?.edgePct ?? 0;
  const confidence =
    (score as { confidencePct?: number } | undefined)?.confidencePct ??
    score?.composite ??
    0;
  const simHit = (score as { simHit?: number } | undefined)?.simHit ?? 0;
  return composite * 0.45 + edge * 0.25 + confidence * 0.2 + simHit * 100 * 0.1;
}

function conflictsOverUnder(a: ParsedPick, b: ParsedPick): boolean {
  if (!a.isProp || !b.isProp || !a.player || !b.player) return false;
  if (a.player.toLowerCase() !== b.player.toLowerCase()) return false;
  if (a.market.toLowerCase() !== b.market.toLowerCase()) return false;
  const pa = a.pick.toLowerCase();
  const pb = b.pick.toLowerCase();
  const aOver = /\bover\b|^o[\s.]/.test(pa);
  const aUnder = /\bunder\b|^u[\s.]/.test(pa);
  const bOver = /\bover\b|^o[\s.]/.test(pb);
  const bUnder = /\bunder\b|^u[\s.]/.test(pb);
  return (aOver && bUnder) || (aUnder && bOver);
}

function sameGameExposureLimit(requestedLegs: number): number {
  if (requestedLegs <= 5) return 2;
  if (requestedLegs <= 9) return 3;
  return 4;
}

/** Greedy EV-ranked selection with correlation penalties — no exhaustive combinations. */
export function greedyCorrelatedPicks(
  candidates: readonly ParsedPick[],
  requestedLegs: number,
): ParsedPick[] {
  const legTarget = requestedLegs > 0 ? requestedLegs : candidates.length;
  if (!candidates.length || legTarget <= 0) return [];

  const pool = [...candidates]
    .sort((a, b) => rankScore(b) - rankScore(a))
    .slice(0, maxCorrelationCandidates(legTarget));

  const ranked = pool.map((pick) => ({ pick, rankScore: rankScore(pick) }));
  const selected: ParsedPick[] = [];
  const usedFp = new Set<string>();
  const gameCounts = new Map<string, number>();
  const maxPerGame = sameGameExposureLimit(legTarget);

  while (selected.length < legTarget) {
    let bestIdx = -1;
    let bestScore = -Infinity;

    for (let i = 0; i < ranked.length; i++) {
      const row = ranked[i]!;
      const fp = pickLegFingerprint(row.pick);
      if (usedFp.has(fp)) continue;
      if (selected.some((s) => conflictsOverUnder(s, row.pick))) continue;

      const gameKey = normGame(row.pick.game);
      if ((gameCounts.get(gameKey) ?? 0) >= maxPerGame) continue;

      const effective = row.rankScore - parlayCorrelationPenalty(row.pick, selected);
      if (effective > bestScore) {
        bestScore = effective;
        bestIdx = i;
      }
    }

    if (bestIdx < 0) break;
    const pick = ranked[bestIdx]!.pick;
    const fp = pickLegFingerprint(pick);
    usedFp.add(fp);
    selected.push(pick);
    const gameKey = normGame(pick.game);
    gameCounts.set(gameKey, (gameCounts.get(gameKey) ?? 0) + 1);
  }

  if (selected.length < legTarget) {
    for (const row of ranked) {
      if (selected.length >= legTarget) break;
      const fp = pickLegFingerprint(row.pick);
      if (usedFp.has(fp)) continue;
      usedFp.add(fp);
      selected.push(row.pick);
    }
  }

  return selected.slice(0, legTarget);
}

function logStart(input: CoachCorrelationInput): void {
  console.log(
    "[coach-correlation] start",
    JSON.stringify({
      requestId: input.requestId,
      candidateCount: input.candidates.length,
      requestedLegs: input.requestedLegs,
    }),
  );
}

function logComplete(result: CoachCorrelationResult): void {
  console.log(
    "[coach-correlation] complete",
    JSON.stringify({
      requestId: result.requestId,
      inputCount: result.inputCount,
      outputCount: result.outputCount,
      durationMs: result.durationMs,
    }),
  );
}

function logTimeout(requestId: string, durationMs: number): void {
  console.log(
    "[coach-correlation] timeout",
    JSON.stringify({ requestId, durationMs }),
  );
}

function logError(requestId: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : undefined;
  console.log(
    "[coach-correlation] error",
    JSON.stringify({ requestId, message, stack }),
  );
}

function logFallbackUsed(): void {
  if (typeof __DEV__ !== "undefined" && __DEV__) {
    console.log("[coach-correlation] fallback-used");
  }
}

function fallbackRanking(
  candidates: readonly ParsedPick[],
  requestedLegs: number,
): ParsedPick[] {
  return greedyCorrelatedPicks(candidates, requestedLegs);
}

function runCorrelationBody(input: CoachCorrelationInput): CoachCorrelationResult {
  const { requestId, candidates, requestedLegs } = input;
  const start = Date.now();
  const inputCount = candidates.length;
  const legTarget = requestedLegs > 0 ? requestedLegs : inputCount;

  if (!inputCount) {
    const durationMs = Date.now() - start;
    const result: CoachCorrelationResult = {
      requestId,
      requestedLegs: legTarget,
      inputCount: 0,
      outputCount: 0,
      durationMs,
      outcome: "empty",
      picks: [],
    };
    logComplete(result);
    return result;
  }

  try {
    const picks = greedyCorrelatedPicks(candidates, legTarget);
    const durationMs = Date.now() - start;
    const result: CoachCorrelationResult = {
      requestId,
      requestedLegs: legTarget,
      inputCount,
      outputCount: picks.length,
      durationMs,
      outcome: picks.length ? "completed" : "empty",
      picks,
    };
    logComplete(result);
    return result;
  } catch (err) {
    const durationMs = Date.now() - start;
    logError(requestId, err);
    logFallbackUsed();
    const picks = fallbackRanking(candidates, legTarget);
    return {
      requestId,
      requestedLegs: legTarget,
      inputCount,
      outputCount: picks.length,
      durationMs,
      outcome: "error-fallback",
      picks,
    };
  }
}

/** Synchronous correlation — used by staging when scan results are built. */
export function runCoachCorrelationSync(input: CoachCorrelationInput): CoachCorrelationResult {
  if (completedRequestIds.has(input.requestId)) {
    return runCorrelationBody(input);
  }
  logStart(input);
  const result = runCorrelationBody(input);
  completedRequestIds.add(input.requestId);
  return result;
}

/**
 * Run correlation once per requestId with a 5s hard timeout.
 * Slow work is cancelled logically — fallback ranking is used instead.
 */
export function runCoachCorrelation(input: CoachCorrelationInput): Promise<CoachCorrelationResult> {
  const { requestId } = input;
  tracePipelineEnter("runCorrelation", {
    activeRequestId: requestId,
    pickCount: input.candidates.length,
    selectedCount: 0,
    correlationRequestId: requestId,
  });
  if (completedRequestIds.has(requestId)) {
    const result = runCorrelationBody(input);
    tracePipelineExit("runCorrelation", {
      activeRequestId: requestId,
      pickCount: input.candidates.length,
      selectedCount: result.outputCount,
      correlationRequestId: requestId,
    });
    return Promise.resolve(result);
  }
  const pending = inFlight.get(requestId);
  if (pending) return pending;

  logStart(input);

  const promise = new Promise<CoachCorrelationResult>((resolve) => {
    const start = Date.now();
    let settled = false;

    const finish = (result: CoachCorrelationResult) => {
      if (settled) return;
      settled = true;
      completedRequestIds.add(requestId);
      inFlight.delete(requestId);
      tracePipelineExit("runCorrelation", {
        activeRequestId: requestId,
        pickCount: result.inputCount,
        selectedCount: result.outputCount,
        correlationRequestId: requestId,
      });
      resolve(result);
    };

    const timer = setTimeout(() => {
      const durationMs = Date.now() - start;
      logTimeout(requestId, durationMs);
      logFallbackUsed();
      const picks = fallbackRanking(input.candidates, input.requestedLegs);
      finish({
        requestId,
        requestedLegs: input.requestedLegs,
        inputCount: input.candidates.length,
        outputCount: picks.length,
        durationMs,
        outcome: picks.length ? "timeout-fallback" : "empty",
        picks,
      });
    }, COACH_CORRELATION_TIMEOUT_MS);

    const runBody = () => {
      try {
        const picks = greedyCorrelatedPicks(input.candidates, input.requestedLegs);
        clearTimeout(timer);
        const durationMs = Date.now() - start;
        const result: CoachCorrelationResult = {
          requestId,
          requestedLegs: input.requestedLegs,
          inputCount: input.candidates.length,
          outputCount: picks.length,
          durationMs,
          outcome: picks.length ? "completed" : "empty",
          picks,
        };
        logComplete(result);
        finish(result);
      } catch (err) {
        clearTimeout(timer);
        const durationMs = Date.now() - start;
        logError(requestId, err);
        logFallbackUsed();
        const picks = fallbackRanking(input.candidates, input.requestedLegs);
        finish({
          requestId,
          requestedLegs: input.requestedLegs,
          inputCount: input.candidates.length,
          outputCount: picks.length,
          durationMs,
          outcome: picks.length ? "error-fallback" : "empty",
          picks,
        });
      }
    };

    setTimeout(runBody, 0);
  });

  inFlight.set(requestId, promise);
  return promise;
}
