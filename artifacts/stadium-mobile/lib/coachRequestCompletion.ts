// Per-request completion guard — blocks duplicate phase/delivery work after a ticket lands.

const completedRequestIds = new Set<string>();

export function markCoachRequestCompleted(requestId: string): void {
  if (requestId) completedRequestIds.add(requestId);
}

export function isCoachRequestCompleted(requestId: string | null | undefined): boolean {
  return !!requestId && completedRequestIds.has(requestId);
}

export function clearCoachRequestCompleted(requestId: string | null | undefined): void {
  if (requestId) completedRequestIds.delete(requestId);
}

export function resetCoachRequestCompletionForTests(): void {
  completedRequestIds.clear();
}

/** True when post-completion phase, recovery, finalize, or delivery-gate work must not run. */
export function shouldSkipPostCompletionCoachWork(
  requestId: string | null | undefined,
): boolean {
  return isCoachRequestCompleted(requestId);
}
