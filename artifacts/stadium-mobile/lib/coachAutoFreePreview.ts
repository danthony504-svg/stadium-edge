/** Start one free two-leg Coach request when a non-premium visitor opens an empty Coach thread. */
export const AUTO_FREE_COACH_ASK = "Build me a 2-leg parlay for today's games using different markets. Only use real sportsbook odds and qualified simulated picks.";
export function shouldAutoBuildFreeCoachPreview(params: {
  subscriptionHydrated: boolean;
  premiumUnlocked: boolean;
  messageCount: number;
  busy: boolean;
  alreadyStartedOnFocus: boolean;
  pendingLaunch: boolean;
}): boolean {
  return params.subscriptionHydrated &&
    !params.premiumUnlocked &&
    params.messageCount === 1 &&
    !params.busy &&
    !params.alreadyStartedOnFocus &&
    !params.pendingLaunch;
}
