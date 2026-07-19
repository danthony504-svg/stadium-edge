// Coach build / board-scan lifecycle — ordering guarantees + timing instrumentation.

export const COACH_BUILD_TIMING_LOG = "[coach-build-timing]";

let boardScanStartedAt: number | null = null;
let buildStartedAt: number | null = null;

export function logBoardScanStarted(requestId?: string): void {
  boardScanStartedAt = Date.now();
  console.log(
    `${COACH_BUILD_TIMING_LOG} boardScanStarted requestId=${requestId ?? "—"} t=${boardScanStartedAt}`,
  );
}

export function logBoardScanFinished(
  requestId?: string,
  extra?: Record<string, string | number | boolean | null | undefined>,
): void {
  const elapsed = boardScanStartedAt != null ? Date.now() - boardScanStartedAt : null;
  const suffix = extra ? ` ${JSON.stringify(extra)}` : "";
  console.log(
    `${COACH_BUILD_TIMING_LOG} boardScanFinished requestId=${requestId ?? "—"} elapsedMs=${elapsed ?? "—"}${suffix}`,
  );
  boardScanStartedAt = null;
}

export function logBuildStarted(requestId?: string): void {
  buildStartedAt = Date.now();
  console.log(
    `${COACH_BUILD_TIMING_LOG} buildStarted requestId=${requestId ?? "—"} t=${buildStartedAt}`,
  );
}

export function logBuildFinished(
  requestId?: string,
  extra?: Record<string, string | number | boolean | null | undefined>,
): void {
  const elapsed = buildStartedAt != null ? Date.now() - buildStartedAt : null;
  const suffix = extra ? ` ${JSON.stringify(extra)}` : "";
  console.log(
    `${COACH_BUILD_TIMING_LOG} buildFinished requestId=${requestId ?? "—"} elapsedMs=${elapsed ?? "—"}${suffix}`,
  );
  buildStartedAt = null;
}

export function logCardsRendered(count: number, requestId?: string): void {
  console.log(
    `${COACH_BUILD_TIMING_LOG} cardsRendered count=${count} requestId=${requestId ?? "—"} t=${Date.now()}`,
  );
}

export type BoardScanRaceResult<T> = {
  /** Result from Promise.race against the budget (may be null if budget expired first). */
  timedResult: T | null;
  /** Await the full scan through pricing, EV, sim, confidence, correlation, selection. */
  awaitCompletion: () => Promise<T | null>;
};

/** Race a board scan against a time budget without abandoning the underlying scan. */
export async function raceBoardScanWithBudget<T>(
  scanPromise: Promise<T | null>,
  budgetMs: number,
  opts?: {
    requestId?: string;
    onInFlightChange?: (inFlight: boolean) => void;
  },
): Promise<BoardScanRaceResult<T | null>> {
  logBoardScanStarted(opts?.requestId);
  opts?.onInFlightChange?.(true);

  const completion = scanPromise
    .catch(() => null as T | null)
    .finally(() => {
      logBoardScanFinished(opts?.requestId);
      opts?.onInFlightChange?.(false);
    });

  const timedResult = await Promise.race([
    completion,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), budgetMs)),
  ]);

  return {
    timedResult: timedResult as T | null,
    awaitCompletion: () => completion,
  };
}

/** Track a board scan promise that is not budget-raced (e.g. early kickoff). */
export function trackBoardScanPromise<T>(
  scanPromise: Promise<T | null>,
  opts?: {
    requestId?: string;
    onInFlightChange?: (inFlight: boolean) => void;
  },
): Promise<T | null> {
  logBoardScanStarted(opts?.requestId);
  opts?.onInFlightChange?.(true);
  return scanPromise
    .catch(() => null as T | null)
    .finally(() => {
      logBoardScanFinished(opts?.requestId);
      opts?.onInFlightChange?.(false);
    });
}
