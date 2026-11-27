export type CoachPropBoardHealth = {
  attempts: number;
  gatewayFailures: number;
  failedAttemptMs: number;
  propLoadMs: number;
  circuitOpen: boolean;
  quotaResetAt?: string;
};

export function createCoachPropBoardHealth(
  now: () => number = Date.now,
  onOpen?: (health: CoachPropBoardHealth) => void,
) {
  const startedAt = now();
  let attempts = 0;
  let gatewayFailures = 0;
  let failedAttemptMs = 0;
  let consecutive502 = 0;
  let circuitOpen = false;
  let quotaResetAt: string | undefined;
  const snapshot = (): CoachPropBoardHealth => ({
    attempts, gatewayFailures, failedAttemptMs, propLoadMs: now() - startedAt, circuitOpen, ...(quotaResetAt ? { quotaResetAt } : {}),
  });
  return {
    allowsAttempt: () => !circuitOpen,
    observe(status: number, elapsedMs: number, resetAt?: string) {
      attempts++;
      if (status === 502) gatewayFailures++;
      if (status === 0 || status >= 400) failedAttemptMs += Math.max(0, elapsedMs);
      consecutive502 = status === 502 ? consecutive502 + 1 : 0;
      if (resetAt) quotaResetAt = resetAt;
      if ((resetAt || consecutive502 >= 3) && (!circuitOpen || resetAt)) {
        circuitOpen = true;
        onOpen?.(snapshot());
      }
    },
    snapshot,
  };
}

export type CoachPropBoardCircuit = ReturnType<typeof createCoachPropBoardHealth>;


export function propBoardPauseMessage(health?: CoachPropBoardHealth): string {
  if (health?.quotaResetAt) {
    const time = new Date(health.quotaResetAt);
    if (Number.isFinite(time.getTime())) {
      const reset = new Intl.DateTimeFormat("en-US", {
        month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
        timeZone: "America/Chicago",
      }).format(time).replace(" at ", ", ");
      return `Prop data paused until the provider quota resets (${reset} Central).`;
    }
    return "Prop data paused until the provider quota resets.";
  }
  return health?.circuitOpen ? "Prop markets unavailable right now." : "";
}
