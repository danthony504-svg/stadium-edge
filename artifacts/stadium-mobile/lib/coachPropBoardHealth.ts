export type CoachPropBoardHealth = {
  attempts: number;
  gatewayFailures: number;
  failedAttemptMs: number;
  propLoadMs: number;
  circuitOpen: boolean;
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
  const snapshot = (): CoachPropBoardHealth => ({
    attempts, gatewayFailures, failedAttemptMs, propLoadMs: now() - startedAt, circuitOpen,
  });
  return {
    allowsAttempt: () => !circuitOpen,
    observe(status: number, elapsedMs: number) {
      attempts++;
      if (status === 502) gatewayFailures++;
      if (status === 0 || status >= 400) failedAttemptMs += Math.max(0, elapsedMs);
      consecutive502 = status === 502 ? consecutive502 + 1 : 0;
      if (consecutive502 >= 3 && !circuitOpen) {
        circuitOpen = true;
        onOpen?.(snapshot());
      }
    },
    snapshot,
  };
}

export type CoachPropBoardCircuit = ReturnType<typeof createCoachPropBoardHealth>;
