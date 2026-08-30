// Single-flight board scan per Coach requestId + terminal abort for late async work.

type ActiveBoardScan = {
  requestId: string;
  controller: AbortController;
  promise: Promise<unknown>;
  aborted: boolean;
  abortReason?: string;
};

const activeScans = new Map<string, ActiveBoardScan>();

export function resetCoachBoardScanGuardForTests(): void {
  for (const entry of activeScans.values()) {
    entry.aborted = true;
    entry.controller.abort();
  }
  activeScans.clear();
}

export function isCoachBoardScanAborted(requestId: string | null | undefined): boolean {
  if (!requestId) return false;
  return activeScans.get(requestId)?.aborted === true;
}

export function getCoachBoardScanSignal(requestId: string | null | undefined): AbortSignal | undefined {
  if (!requestId) return undefined;
  return activeScans.get(requestId)?.controller.signal;
}

/** Abort and mark terminal so late scan/sim work is ignored. */
export function abortCoachBoardScan(
  requestId: string | null | undefined,
  reason = "request_terminal",
): void {
  if (!requestId) return;
  const entry = activeScans.get(requestId);
  if (!entry) {
    const controller = new AbortController();
    controller.abort();
    activeScans.set(requestId, {
      requestId,
      controller,
      promise: Promise.resolve(null),
      aborted: true,
      abortReason: reason,
    });
    return;
  }
  entry.aborted = true;
  entry.abortReason = reason;
  if (!entry.controller.signal.aborted) entry.controller.abort();
}

/**
 * Run at most one board scan per requestId. Concurrent callers join the in-flight
 * promise instead of launching a duplicate scan/prop_sim pass.
 */
export async function runExclusiveCoachBoardScan<T>(
  requestId: string | null | undefined,
  run: (scanSignal: AbortSignal) => Promise<T>,
): Promise<T> {
  const id = requestId?.trim() ?? "";
  if (!id) {
    return run(new AbortController().signal);
  }

  const existing = activeScans.get(id);
  if (existing) {
    if (existing.aborted) {
      const err = new Error(`Coach board scan aborted: ${existing.abortReason ?? "terminal"}`);
      err.name = "AbortError";
      throw err;
    }
    return existing.promise as Promise<T>;
  }

  const controller = new AbortController();
  const entry: ActiveBoardScan = {
    requestId: id,
    controller,
    promise: Promise.resolve(null),
    aborted: false,
  };

  const promise = (async () => {
    try {
      return await run(controller.signal);
    } finally {
      const current = activeScans.get(id);
      // Keep aborted entries so late callers see the terminal state.
      if (current === entry && !entry.aborted) {
        activeScans.delete(id);
      }
    }
  })();

  entry.promise = promise;
  activeScans.set(id, entry);
  return promise;
}

/** Merge send-level and scan-guard abort signals into one. */
export function mergeAbortSignals(
  ...signals: Array<AbortSignal | null | undefined>
): AbortSignal | undefined {
  const active = signals.filter((s): s is AbortSignal => !!s);
  if (!active.length) return undefined;
  if (active.length === 1) return active[0];
  if (active.some((s) => s.aborted)) {
    const done = new AbortController();
    done.abort();
    return done.signal;
  }
  const merged = new AbortController();
  const onAbort = () => merged.abort();
  for (const signal of active) {
    signal.addEventListener("abort", onAbort, { once: true });
  }
  return merged.signal;
}
