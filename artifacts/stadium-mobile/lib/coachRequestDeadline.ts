// Per-request 30s deadline — abort in-flight work and allow handled error delivery.

export const COACH_REQUEST_DEADLINE_MS = 30_000;

export const COACH_REQUEST_DEADLINE_LOG = "[coach-request-deadline]";

type RequestScope = {
  requestId: string;
  sendGeneration: number;
  controller: AbortController;
  timer: ReturnType<typeof setTimeout> | null;
  startedAt: number;
  cancelled: boolean;
};

let activeScope: RequestScope | null = null;
const scopesById = new Map<string, RequestScope>();

function log(event: string, requestId: string, extra?: Record<string, unknown>): void {
  const tail = extra ? ` ${JSON.stringify(extra)}` : "";
  console.log(`${COACH_REQUEST_DEADLINE_LOG} ${event} requestId=${requestId}${tail}`);
}

export function resetCoachRequestDeadlineForTests(): void {
  for (const scope of scopesById.values()) {
    if (scope.timer) clearTimeout(scope.timer);
    scope.controller.abort();
  }
  scopesById.clear();
  activeScope = null;
}

export function beginCoachRequestScope(
  requestId: string,
  sendGeneration: number,
  onDeadline?: (requestId: string) => void,
): AbortSignal {
  cancelCoachRequestScope(activeScope?.requestId, "superseded");
  const controller = new AbortController();
  const startedAt = Date.now();
  const scope: RequestScope = {
    requestId,
    sendGeneration,
    controller,
    timer: null,
    startedAt,
    cancelled: false,
  };
  scope.timer = setTimeout(() => {
    log("deadline-expired", requestId, {
      sendGeneration,
      elapsedMs: Date.now() - startedAt,
      limitMs: COACH_REQUEST_DEADLINE_MS,
    });
    controller.abort();
    onDeadline?.(requestId);
  }, COACH_REQUEST_DEADLINE_MS);
  scopesById.set(requestId, scope);
  activeScope = scope;
  log("scope-start", requestId, { sendGeneration, startedAt });
  return controller.signal;
}

export function cancelCoachRequestScope(
  requestId: string | null | undefined,
  reason = "cancelled",
): void {
  if (!requestId) return;
  const scope = scopesById.get(requestId);
  if (!scope || scope.cancelled) return;
  scope.cancelled = true;
  if (scope.timer) clearTimeout(scope.timer);
  scope.controller.abort();
  log("scope-cancel", requestId, { reason, sendGeneration: scope.sendGeneration });
  if (activeScope?.requestId === requestId) activeScope = null;
}

export function coachRequestScopeIsActive(
  requestId: string,
  sendGeneration?: number,
): boolean {
  const scope = scopesById.get(requestId);
  if (!scope || scope.cancelled) return false;
  if (activeScope?.requestId !== requestId) return false;
  if (sendGeneration != null && scope.sendGeneration !== sendGeneration) return false;
  return true;
}

export function getCoachRequestScopeSignal(requestId: string): AbortSignal | undefined {
  return scopesById.get(requestId)?.controller.signal;
}

export function clearCoachRequestScope(requestId: string): void {
  const scope = scopesById.get(requestId);
  if (!scope) return;
  if (scope.timer) clearTimeout(scope.timer);
  scopesById.delete(requestId);
  if (activeScope?.requestId === requestId) activeScope = null;
  log("scope-clear", requestId, { elapsedMs: Date.now() - scope.startedAt });
}

export function coachRequestDeadlineRemainingMs(requestId: string): number {
  const scope = scopesById.get(requestId);
  if (!scope) return 0;
  return Math.max(0, COACH_REQUEST_DEADLINE_MS - (Date.now() - scope.startedAt));
}
