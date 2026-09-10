/** Home one-tap launches set this synchronously before router.push (tab params may drop). */
export type CoachLaunchOpts = {
  hideBubble: boolean;
  freshThread: boolean;
};

let pendingLaunch: CoachLaunchOpts | null = null;

export function markCoachHomeLaunch(): void {
  pendingLaunch = { hideBubble: true, freshThread: true };
}

export function takeCoachLaunch(): CoachLaunchOpts | null {
  const launch = pendingLaunch;
  pendingLaunch = null;
  return launch;
}

/** Drop any Home one-tap launch opts so Coach stays idle on navigation. */
export function clearCoachHomeLaunch(): void {
  pendingLaunch = null;
}

/** Route params for opening Coach without auto-send or resume side effects. */
export function coachIdleNavParams(): Record<string, string> {
  return {
    nav: "idle",
    send: "",
    autoMsg: "",
    prefill: "",
    ts: String(Date.now()),
  };
}
