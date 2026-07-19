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

/** Home "Build best parlay" — open Coach idle (no auto-send, no resume). */
let pendingIdleReset = false;

export function markCoachIdleReset(): void {
  pendingIdleReset = true;
}

export function consumeCoachIdleReset(): boolean {
  if (!pendingIdleReset) return false;
  pendingIdleReset = false;
  return true;
}

/** True while a Home idle-open is in flight (before Coach consumes it). */
export function isCoachIdleResetPending(): boolean {
  return pendingIdleReset;
}
