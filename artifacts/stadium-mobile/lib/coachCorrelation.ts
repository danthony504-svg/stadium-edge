// Coach parlay correlation lifecycle — requestId-scoped, non-blocking, 8–10s hard timeout.

import type { ParsedPick } from "./parsedPick.ts";
import type { TicketStagingBreakdown } from "./fullBoardMarketCopy.ts";
import {
  buildStagedTicketFromScan,
  selectGreedyBoardLegs,
  type BoardScoredLeg,
  type CoachTicketStagingContext,
} from "./ticketStaging.ts";
import { applyCoachTicketFallbackLadder } from "./coachTicketFallbackLadder.ts";

export const COACH_CORRELATION_TIMEOUT_MS = 9_000;
const STORAGE_KEY = "coach_correlation_v1";

export type CoachCorrelationDataStatus = "available" | "unavailable";
export type CoachCorrelationStep = "pending" | "loading" | "complete" | "skipped" | "unavailable";

export type CoachCorrelationRecord = {
  requestId: string;
  step: CoachCorrelationStep;
  correlationStatus: CoachCorrelationDataStatus;
  requestedLegs: number;
  candidateCount?: number;
  selectedCount?: number;
  startedAt: number;
  completedAt?: number;
  error?: string;
};

export type CoachCorrelationResult = {
  record: CoachCorrelationRecord;
  picks: ParsedPick[];
  breakdown: TicketStagingBreakdown;
  correlationStatus: CoachCorrelationDataStatus;
};

export type CoachCorrelationInput = {
  requestId: string;
  target: number;
  scored: BoardScoredLeg[];
  varietySeed?: string;
  varietyContext?: CoachTicketStagingContext;
  preview?: boolean;
};

const records = new Map<string, CoachCorrelationRecord>();
const inFlight = new Map<string, Promise<CoachCorrelationResult>>();
const resultCache = new Map<string, CoachCorrelationResult>();

export type CoachCorrelationRunnerResult = {
  picks: ParsedPick[];
  breakdown: TicketStagingBreakdown;
  candidateCount: number;
};

export type CoachCorrelationRunner = (
  input: CoachCorrelationInput,
) => CoachCorrelationRunnerResult | Promise<CoachCorrelationRunnerResult>;

let correlationRunner: CoachCorrelationRunner = (input) => {
  const staged = buildStagedTicketFromScan(
    input.scored,
    input.target,
    input.varietySeed,
    input.varietyContext,
  );
  return {
    picks: staged.picks,
    breakdown: staged.breakdown,
    candidateCount: input.scored.length,
  };
};

let correlationTimeoutMs = COACH_CORRELATION_TIMEOUT_MS;

export function setCoachCorrelationRunnerForTests(runner: CoachCorrelationRunner | null): void {
  correlationRunner = runner ?? ((input) => {
    const staged = buildStagedTicketFromScan(
      input.scored,
      input.target,
      input.varietySeed,
      input.varietyContext,
    );
    return {
      picks: staged.picks,
      breakdown: staged.breakdown,
      candidateCount: input.scored.length,
    };
  });
}

export function setCoachCorrelationTimeoutForTests(ms: number | null): void {
  correlationTimeoutMs = ms ?? COACH_CORRELATION_TIMEOUT_MS;
}

function log(event: string, requestId: string, extra?: Record<string, unknown>): void {
  const tail = extra ? ` ${JSON.stringify(extra)}` : "";
  console.log(`[coach-correlation] ${event} requestId=${requestId}${tail}`);
}

function emptyBreakdown(): TicketStagingBreakdown {
  return { mainQualified: 0, altQualified: 0, mainOnTicket: 0, altOnTicket: 0 };
}

function rankedFallback(
  scored: BoardScoredLeg[],
  target: number,
  varietySeed?: string,
): { picks: ParsedPick[]; breakdown: TicketStagingBreakdown } {
  const greedy = selectGreedyBoardLegs(
    scored.filter((leg) => leg.pick.finalAiScore && (leg.edgePct ?? 0) > 0),
    target,
    varietySeed,
  ).map((pick) => ({
    ...pick,
    ticketRole: pick.ticketRole ?? ("main" as const),
  }));
  const fallback = applyCoachTicketFallbackLadder(scored, greedy, target, varietySeed);
  const picks = fallback.picks;
  const mains = picks.filter((p) => p.ticketRole !== "alt").length;
  return {
    picks,
    breakdown: {
      mainQualified: scored.length,
      altQualified: 0,
      mainOnTicket: mains,
      altOnTicket: picks.length - mains,
    },
  };
}

function cacheResult(result: CoachCorrelationResult): CoachCorrelationResult {
  records.set(result.record.requestId, result.record);
  resultCache.set(result.record.requestId, result);
  return result;
}

export function resetCoachCorrelationForTests(): void {
  records.clear();
  inFlight.clear();
  resultCache.clear();
  setCoachCorrelationRunnerForTests(null);
  setCoachCorrelationTimeoutForTests(null);
}

export function getCoachCorrelationRecord(requestId: string | null | undefined): CoachCorrelationRecord | null {
  if (!requestId) return null;
  return records.get(requestId) ?? null;
}

export function coachCorrelationStepComplete(record: CoachCorrelationRecord | null | undefined): boolean {
  if (!record) return false;
  return record.step !== "pending" && record.step !== "loading";
}

function finalizeUnavailable(
  requestId: string,
  target: number,
  startedAt: number,
  scored: BoardScoredLeg[],
  varietySeed: string | undefined,
  reason: string,
  candidateCount = 0,
): CoachCorrelationResult {
  const fallback = rankedFallback(scored, target, varietySeed);
  const record: CoachCorrelationRecord = {
    requestId,
    step: "unavailable",
    correlationStatus: "unavailable",
    requestedLegs: target,
    candidateCount,
    selectedCount: fallback.picks.length,
    startedAt,
    completedAt: Date.now(),
    error: reason,
  };
  log("continue-without-data", requestId, {
    correlationStatus: "unavailable",
    reason,
    selectedCount: fallback.picks.length,
  });
  return cacheResult({
    record,
    picks: fallback.picks,
    breakdown: fallback.breakdown,
    correlationStatus: "unavailable",
  });
}

function runCoachCorrelationCore(input: CoachCorrelationInput): Promise<CoachCorrelationResult> {
  const { requestId, target, scored, varietySeed, preview } = input;
  const startedAt = Date.now();
  log("start", requestId, { requestedLegs: target, preview: !!preview, candidatePool: scored.length });

  if (!scored.length) {
    log("empty", requestId, { candidateCount: 0 });
    const record: CoachCorrelationRecord = {
      requestId,
      step: "skipped",
      correlationStatus: "unavailable",
      requestedLegs: target,
      candidateCount: 0,
      selectedCount: 0,
      startedAt,
      completedAt: Date.now(),
    };
    log("continue-without-data", requestId, { correlationStatus: "unavailable", reason: "empty-pool" });
    return Promise.resolve(
      cacheResult({
        record,
        picks: [],
        breakdown: emptyBreakdown(),
        correlationStatus: "unavailable",
      }),
    );
  }

  return Promise.resolve(correlationRunner(input))
    .then((response) => {
      const candidateCount = response.candidateCount;
      log("candidate-count", requestId, { candidateCount, requestedLegs: target });
      log("response", requestId, {
        candidateCount,
        selectedCount: response.picks.length,
        bodyShape: `picks:${response.picks.length},main:${response.breakdown.mainOnTicket},alt:${response.breakdown.altOnTicket}`,
      });

      if (!response.picks.length) {
        const fallback = rankedFallback(scored, target, varietySeed);
        const record: CoachCorrelationRecord = {
          requestId,
          step: fallback.picks.length ? "unavailable" : "skipped",
          correlationStatus: "unavailable",
          requestedLegs: target,
          candidateCount,
          selectedCount: fallback.picks.length,
          startedAt,
          completedAt: Date.now(),
        };
        log("empty", requestId, { candidateCount, selectedCount: fallback.picks.length });
        log("continue-without-data", requestId, { correlationStatus: "unavailable", reason: "empty-response" });
        return cacheResult({
          record,
          picks: fallback.picks,
          breakdown: fallback.breakdown,
          correlationStatus: "unavailable",
        });
      }

      const record: CoachCorrelationRecord = {
        requestId,
        step: "complete",
        correlationStatus: "available",
        requestedLegs: target,
        candidateCount,
        selectedCount: response.picks.length,
        startedAt,
        completedAt: Date.now(),
      };
      log("selected-count", requestId, { selectedCount: response.picks.length, candidateCount });
      log("complete", requestId, { selectedCount: response.picks.length, correlationStatus: "available" });
      return cacheResult({
        record,
        picks: response.picks,
        breakdown: response.breakdown,
        correlationStatus: "available",
      });
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      log("error", requestId, { error: message });
      return finalizeUnavailable(requestId, target, startedAt, scored, varietySeed, message, scored.length);
    });
}

async function runCoachCorrelationFetch(input: CoachCorrelationInput): Promise<CoachCorrelationResult> {
  const { requestId } = input;
  const existing = records.get(requestId);
  if (existing && coachCorrelationStepComplete(existing)) {
    const cached = resultCache.get(requestId);
    if (cached) return cached;
  }

  const startedAt = Date.now();
  const loading: CoachCorrelationRecord = {
    requestId,
    step: "loading",
    correlationStatus: "unavailable",
    requestedLegs: input.target,
    startedAt,
  };
  records.set(requestId, loading);
  void persistCoachCorrelation(loading);

  try {
    const result = await Promise.race([
      runCoachCorrelationCore(input),
      new Promise<CoachCorrelationResult>((_, reject) => {
        setTimeout(() => reject(new Error("coach-correlation-timeout")), correlationTimeoutMs);
      }),
    ]);
    void persistCoachCorrelation(result.record);
    return result;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("coach-correlation-timeout")) {
      log("timeout", requestId, { elapsedMs: Date.now() - startedAt, requestedLegs: input.target });
    } else {
      log("error", requestId, { error: message });
    }
    const result = finalizeUnavailable(
      requestId,
      input.target,
      startedAt,
      input.scored,
      input.varietySeed,
      message.includes("coach-correlation-timeout") ? "timeout" : message,
      input.scored.length,
    );
    void persistCoachCorrelation(result.record);
    return result;
  }
}

/** Idempotent per requestId — dedupes in-flight, rerender, and app-resume retries. */
export function fetchCoachCorrelationForBuild(input: CoachCorrelationInput): Promise<CoachCorrelationResult> {
  const { requestId, preview } = input;
  if (preview) {
    return runCoachCorrelationCore(input);
  }

  const existing = records.get(requestId);
  if (existing && coachCorrelationStepComplete(existing)) {
    const cached = resultCache.get(requestId);
    if (cached) return Promise.resolve(cached);
  }

  const pending = inFlight.get(requestId);
  if (pending) return pending;

  const promise = runCoachCorrelationFetch(input);
  inFlight.set(requestId, promise);
  promise.finally(() => inFlight.delete(requestId));
  return promise;
}

export async function persistCoachCorrelation(record: CoachCorrelationRecord): Promise<void> {
  try {
    const { default: AsyncStorage } = await import("@react-native-async-storage/async-storage");
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(record));
  } catch {
    /* storage unavailable */
  }
}

export async function loadPersistedCoachCorrelation(): Promise<CoachCorrelationRecord | null> {
  try {
    const { default: AsyncStorage } = await import("@react-native-async-storage/async-storage");
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CoachCorrelationRecord;
    if (!parsed?.requestId) return null;
    records.set(parsed.requestId, parsed);
    return parsed;
  } catch {
    return null;
  }
}

export async function clearPersistedCoachCorrelation(): Promise<void> {
  try {
    const { default: AsyncStorage } = await import("@react-native-async-storage/async-storage");
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
