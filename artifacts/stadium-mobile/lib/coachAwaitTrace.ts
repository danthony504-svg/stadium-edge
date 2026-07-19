// Per-await tracing between injury check and line-value / correlation — backend only.

export const COACH_AWAIT_TRACE_LOG = "[coach-await-trace]";

export const COACH_NETWORK_AWAIT_TIMEOUT_MS = 10_000;

export type CoachAwaitTraceSite = {
  fn: string;
  file: string;
  line: number;
};

export type CoachAwaitTraceOutcome =
  | "resolved"
  | "rejected"
  | "timeout"
  | "cancelled"
  | "never-completed";

export type CoachAwaitTraceRecord = {
  requestId: string;
  label: string;
  fn: string;
  file: string;
  line: number;
  startedAt: number;
  finishedAt: number | null;
  durationMs: number | null;
  outcome: CoachAwaitTraceOutcome;
  exception: string | null;
  dependency: string | null;
};

const recordsByRequest = new Map<string, CoachAwaitTraceRecord[]>();
const pendingByRequest = new Map<string, Set<string>>();

function logLine(message: string): void {
  console.log(`${COACH_AWAIT_TRACE_LOG} ${message}`);
}

function captureStack(label: string): string {
  const err = new Error(label);
  return err.stack ?? label;
}

export function resetCoachAwaitTraceForTests(): void {
  recordsByRequest.clear();
  pendingByRequest.clear();
}

export function getCoachAwaitTraceRecords(requestId: string): CoachAwaitTraceRecord[] {
  return [...(recordsByRequest.get(requestId) ?? [])];
}

function pushRecord(requestId: string, record: CoachAwaitTraceRecord): void {
  const list = recordsByRequest.get(requestId) ?? [];
  list.push(record);
  recordsByRequest.set(requestId, list);
}

function formatRecord(r: CoachAwaitTraceRecord): string {
  return [
    `requestId=${r.requestId}`,
    `fn=${r.fn}`,
    `file=${r.file}`,
    `line=${r.line}`,
    `label=${r.label}`,
    `start=${r.startedAt}`,
    `end=${r.finishedAt ?? "—"}`,
    `durationMs=${r.durationMs ?? "—"}`,
    `outcome=${r.outcome}`,
    r.exception ? `exception=${r.exception}` : null,
    r.dependency ? `dependency=${r.dependency}` : null,
  ]
    .filter(Boolean)
    .join(" ");
}

function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const name = (err as { name?: string }).name;
  return name === "AbortError";
}

/**
 * Trace a single await with optional hard timeout (default 10s for network work).
 * Pass timeoutMs: 0 to wait without a timeout (long board-scan completion).
 */
export async function traceCoachAwait<T>(
  requestId: string,
  site: CoachAwaitTraceSite,
  label: string,
  run: () => Promise<T>,
  opts?: {
    timeoutMs?: number;
    signal?: AbortSignal;
    dependency?: string;
    onTimeout?: () => T | Promise<T>;
  },
): Promise<T> {
  const startedAt = Date.now();
  const pendingKey = `${site.file}:${site.line}:${label}`;
  const pending = pendingByRequest.get(requestId) ?? new Set<string>();
  pending.add(pendingKey);
  pendingByRequest.set(requestId, pending);

  logLine(`await-start ${formatRecord({
    requestId,
    label,
    fn: site.fn,
    file: site.file,
    line: site.line,
    startedAt,
    finishedAt: null,
    durationMs: null,
    outcome: "never-completed",
    exception: null,
    dependency: opts?.dependency ?? null,
  })}`);

  const timeoutMs = opts?.timeoutMs ?? COACH_NETWORK_AWAIT_TIMEOUT_MS;
  const useTimeout = timeoutMs > 0;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let timedOut = false;
  const blockingStack = captureStack(`await:${label}`);

  const finish = (
    outcome: CoachAwaitTraceOutcome,
    exception: string | null,
    finishedAt: number,
  ): CoachAwaitTraceRecord => {
    pending.delete(pendingKey);
    const record: CoachAwaitTraceRecord = {
      requestId,
      label,
      fn: site.fn,
      file: site.file,
      line: site.line,
      startedAt,
      finishedAt,
      durationMs: finishedAt - startedAt,
      outcome,
      exception,
      dependency: opts?.dependency ?? null,
    };
    pushRecord(requestId, record);
    logLine(`await-finish ${formatRecord(record)}`);
    if (outcome === "timeout" || outcome === "never-completed") {
      logLine(`await-blocking-stack requestId=${requestId} label=${label} ${blockingStack}`);
    }
    return record;
  };

  try {
    if (opts?.signal?.aborted) {
      finish("cancelled", "AbortError", Date.now());
      const aborted = new Error("Aborted");
      aborted.name = "AbortError";
      throw aborted;
    }

    const work = run();
    const result = await Promise.race([
      work,
      ...(useTimeout
        ? [
            new Promise<never>((_, reject) => {
              timeoutId = setTimeout(() => {
                timedOut = true;
                reject(new Error(`coach-await-timeout:${label}`));
              }, timeoutMs);
            }),
          ]
        : []),
    ]);

    if (timeoutId) clearTimeout(timeoutId);
    finish("resolved", null, Date.now());
    return result;
  } catch (err: unknown) {
    if (timeoutId) clearTimeout(timeoutId);
    const message = err instanceof Error ? err.message : String(err);
    if (timedOut || message.includes("coach-await-timeout")) {
      finish("timeout", message, Date.now());
      if (opts?.onTimeout) {
        logLine(`await-timeout-fallback requestId=${requestId} label=${label}`);
        return opts.onTimeout();
      }
      throw err;
    }
    if (isAbortError(err)) {
      finish("cancelled", message, Date.now());
      throw err;
    }
    finish("rejected", message, Date.now());
    throw err;
  }
}

/** Wrap an existing promise (no factory) for tracing. */
export function traceCoachAwaitPromise<T>(
  requestId: string,
  site: CoachAwaitTraceSite,
  label: string,
  promise: Promise<T>,
  opts?: Parameters<typeof traceCoachAwait<T>>[4],
): Promise<T> {
  return traceCoachAwait(requestId, site, label, () => promise, opts);
}

export function logCoachAwaitTraceSummary(requestId: string): void {
  const records = getCoachAwaitTraceRecords(requestId);
  const pending = pendingByRequest.get(requestId);
  logLine(`── await summary requestId=${requestId} records=${records.length} pending=${pending?.size ?? 0} ──`);
  for (const r of records) {
    logLine(`  ${formatRecord(r)}`);
  }
  if (pending?.size) {
    for (const key of pending) {
      logLine(`  PENDING ${key}`);
    }
  }
}
