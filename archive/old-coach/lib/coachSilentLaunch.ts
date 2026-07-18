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
