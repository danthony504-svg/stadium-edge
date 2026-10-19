/** Start one free two-leg Coach request when a non-premium visitor opens an empty Coach thread. */
export const AUTO_FREE_COACH_ASK = "Build me a 2-leg parlay from the next available upcoming games using different markets. Only use real sportsbook odds and qualified simulated picks.";
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

export type FreeCoachStyle = "hot" | "easy" | "value" | "longshot";
export function freeCoachAskForStyle(style?: FreeCoachStyle): string {
  const intent = {
    hot: "Prioritize the strongest qualified picks across different markets.",
    easy: "Favor higher estimated success probability while preserving the full qualification and real-odds requirements.",
    value: "Prioritize positive expected value and independently supported edges.",
    longshot: "Favor higher-payout qualifying markets where available; never add weak or unqualified legs.",
  }[style ?? "hot"];
  return `Build me a 2-leg parlay from the next available upcoming games using different markets. ${intent} Only use real sportsbook odds and qualified simulated picks.`;
}
