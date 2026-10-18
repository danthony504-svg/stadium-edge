/**
 * Monotonic Coach request deadline — one clock from request start.
 *
 * Load, enrichment, simulation, and finalization share the same budget.
 * Remaining time shrinks; the clock is never reset after prop prefetch.
 */

import { coachAbsoluteBudgetMs, coachFinalizationReserveMs } from "./session.ts";

export type CoachRequestPhase =
  | "init"
  | "load"
  | "context"
  | "scan"
  | "props_only"
  | "finalization"
  | "terminal";

export type CoachTimeoutReason =
  | "load_deadline"
  | "context_deadline"
  | "scan_deadline"
  | "finalization_deadline"
  | "user_cancelled"
  | "absolute_budget";

export type CoachRequestTiming = {
  requestStartedAtMs: number;
  budgetMs: number;
  loadMs: number | null;
  contextMs: number | null;
  scanMs: number | null;
  finalizationMs: number | null;
  totalMs: number | null;
  lastCompletedPhase: CoachRequestPhase;
  pendingOperation: CoachRequestPhase | null;
  timeoutReason: CoachTimeoutReason | null;
  timedOut: boolean;
  deliveryCommitted: boolean;
};

/** Total wall budget for the entire Coach request (includes load). */
export function coachTotalRequestBudgetMs(requestedLegs: number): number {
  return coachAbsoluteBudgetMs(requestedLegs);
}

export function coachRequestDeadlineMs(
  requestStartedAtMs: number,
  budgetMs: number,
): number {
  return requestStartedAtMs + Math.max(0, budgetMs);
}

/** Milliseconds remaining before the monotonic deadline (never negative). */
export function coachRemainingBudgetMs(
  requestStartedAtMs: number,
  budgetMs: number,
  now = Date.now(),
): number {
  return Math.max(0, coachRequestDeadlineMs(requestStartedAtMs, budgetMs) - now);
}

export function coachPastRequestDeadline(
  requestStartedAtMs: number,
  budgetMs: number,
  now = Date.now(),
): boolean {
  return coachRemainingBudgetMs(requestStartedAtMs, budgetMs, now) <= 0;
}

/**
 * Soft phase caps from remaining time — never invent artificial waits.
 * Finalization reserve is preserved when enough time remains.
 */
export function coachPhaseBudgetMs(opts: {
  remainingMs: number;
  phase: "load" | "context" | "scan" | "finalization";
}): number {
  const remaining = Math.max(0, opts.remainingMs);
  const reserve = coachFinalizationReserveMs();
  if (opts.phase === "finalization") {
    return Math.min(remaining, reserve);
  }
  if (opts.phase === "scan") {
    // Leave finalization reserve when possible; otherwise spend what remains.
    return remaining > reserve ? remaining - reserve : remaining;
  }
  // load / context: may consume remaining; caller should still check deadline.
  return remaining;
}

export function createCoachRequestTiming(opts: {
  requestStartedAtMs: number;
  budgetMs: number;
}): CoachRequestTiming {
  return {
    requestStartedAtMs: opts.requestStartedAtMs,
    budgetMs: opts.budgetMs,
    loadMs: null,
    contextMs: null,
    scanMs: null,
    finalizationMs: null,
    totalMs: null,
    lastCompletedPhase: "init",
    pendingOperation: null,
    timeoutReason: null,
    timedOut: false,
    deliveryCommitted: false,
  };
}

export function markCoachPhase(
  timing: CoachRequestTiming,
  phase: CoachRequestPhase,
  durationMs?: number | null,
): void {
  timing.lastCompletedPhase = phase;
  timing.pendingOperation = null;
  if (typeof durationMs === "number" && Number.isFinite(durationMs)) {
    const ms = Math.max(0, Math.round(durationMs));
    if (phase === "load") timing.loadMs = ms;
    else if (phase === "context") timing.contextMs = ms;
    else if (phase === "scan" || phase === "props_only") timing.scanMs = ms;
    else if (phase === "finalization") timing.finalizationMs = ms;
  }
}

export function markCoachPending(
  timing: CoachRequestTiming,
  phase: CoachRequestPhase | null,
): void {
  timing.pendingOperation = phase;
}

export function finalizeCoachRequestTiming(
  timing: CoachRequestTiming,
  now = Date.now(),
): CoachRequestTiming {
  timing.totalMs = Math.max(0, now - timing.requestStartedAtMs);
  timing.pendingOperation = null;
  timing.lastCompletedPhase = "terminal";
  return timing;
}

/**
 * Evidence-supported timeout root cause for Telegram.
 * Only returns a reason when timedOut/cancelled with a known phase.
 */
export function coachTimeoutRootCause(timing: CoachRequestTiming): {
  rootCause: string;
  rootCauseGrade: "verified" | "inferred";
} | null {
  if (timing.timeoutReason === "user_cancelled") {
    return { rootCause: "user_cancelled", rootCauseGrade: "verified" };
  }
  if (!timing.timedOut) return null;
  switch (timing.timeoutReason) {
    case "load_deadline":
      return { rootCause: "load_deadline", rootCauseGrade: "verified" };
    case "context_deadline":
      return { rootCause: "context_deadline", rootCauseGrade: "verified" };
    case "scan_deadline":
      return { rootCause: "scan_deadline", rootCauseGrade: "verified" };
    case "finalization_deadline":
      return { rootCause: "finalization_deadline", rootCauseGrade: "verified" };
    case "absolute_budget":
      return {
        rootCause: `absolute_budget_after_${timing.lastCompletedPhase}`,
        rootCauseGrade: "inferred",
      };
    default:
      return {
        rootCause: `absolute_budget_after_${timing.lastCompletedPhase}`,
        rootCauseGrade: "inferred",
      };
  }
}

/**
 * Link a child AbortController that aborts when the parent aborts or the
 * monotonic deadline elapses. Caller should clear the timer on completion.
 */
export function armDeadlineAbort(opts: {
  parent: AbortSignal;
  remainingMs: number;
  reason?: string;
}): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const onParentAbort = () => {
    if (!controller.signal.aborted) controller.abort();
  };
  if (opts.parent.aborted) {
    controller.abort();
  } else {
    opts.parent.addEventListener("abort", onParentAbort, { once: true });
    const wait = Math.max(0, Math.floor(opts.remainingMs));
    if (wait === 0) {
      controller.abort();
    } else {
      timer = setTimeout(() => {
        timer = null;
        if (!controller.signal.aborted) controller.abort();
      }, wait);
    }
  }
  return {
    signal: controller.signal,
    dispose: () => {
      if (timer) clearTimeout(timer);
      timer = null;
      opts.parent.removeEventListener("abort", onParentAbort);
    },
  };
}

/** True when a late async completion must not overwrite a terminalized request. */
export function coachMayApplyLateBuildResult(opts: {
  deliveryTerminalized: boolean;
  sendGenMatches: boolean;
}): boolean {
  if (!opts.sendGenMatches) return false;
  if (opts.deliveryTerminalized) return false;
  return true;
}

/**
 * Race a promise against a timeout and optional AbortSignals with guaranteed
 * cleanup: timer cleared and abort listeners removed as soon as any branch
 * settles (success, timeout, abort, or rejection).
 *
 * Used by buildParlay scan / grace / drain waits so a fast scan cannot leave
 * orphaned timeouts or listeners across consecutive Coach requests.
 */

export type CoachRaceClock = {
  setTimeout: typeof setTimeout;
  clearTimeout: typeof clearTimeout;
};

let activeCoachRaceCount = 0;

/** Test-only — pending raceWithTimeoutAndAbort calls (timer/listeners live). */
export function getActiveCoachRaceCountForTests(): number {
  return activeCoachRaceCount;
}

/** Test-only — reset leak counter between suites. */
export function resetActiveCoachRaceCountForTests(): void {
  activeCoachRaceCount = 0;
}

export async function raceWithTimeoutAndAbort<T>(opts: {
  promise: Promise<T>;
  timeoutMs: number;
  signals?: AbortSignal[];
  onTimeout: () => T;
  /** Defaults to onTimeout when omitted. */
  onAbort?: () => T;
  clock?: CoachRaceClock;
}): Promise<T> {
  const clock = opts.clock ?? {
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
  };
  const signals = (opts.signals ?? []).filter(
    (s): s is AbortSignal => !!s && typeof s.addEventListener === "function",
  );

  let timer: ReturnType<typeof setTimeout> | null = null;
  let settled = false;
  const listeners: Array<{ signal: AbortSignal; fn: () => void }> = [];

  const cleanup = () => {
    if (timer != null) {
      clock.clearTimeout(timer);
      timer = null;
    }
    for (const { signal, fn } of listeners) {
      try {
        signal.removeEventListener("abort", fn);
      } catch {
        /* fail soft */
      }
    }
    listeners.length = 0;
  };

  activeCoachRaceCount += 1;
  try {
    return await new Promise<T>((resolve, reject) => {
      const finish = (produce: () => T) => {
        if (settled) return;
        settled = true;
        cleanup();
        try {
          resolve(produce());
        } catch (err) {
          reject(err);
        }
      };

      void opts.promise.then(
        (value) => finish(() => value),
        (err) => {
          if (settled) return;
          settled = true;
          cleanup();
          reject(err);
        },
      );

      const waitMs = Math.max(0, Math.floor(opts.timeoutMs));
      timer = clock.setTimeout(() => finish(opts.onTimeout), waitMs);

      const abortProduce = () => (opts.onAbort ?? opts.onTimeout)();
      for (const signal of signals) {
        const onAbort = () => finish(abortProduce);
        if (signal.aborted) {
          onAbort();
          continue;
        }
        signal.addEventListener("abort", onAbort);
        listeners.push({ signal, fn: onAbort });
      }
    });
  } finally {
    // Belt-and-suspenders: settle path already cleaned; this covers rejects.
    cleanup();
    activeCoachRaceCount = Math.max(0, activeCoachRaceCount - 1);
  }
}
