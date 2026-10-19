/** Home one-tap launches set this synchronously before router.push (tab params may drop). */
export type CoachLaunchOpts = {
  hideBubble: boolean;
  freshThread: boolean;
  freePreviewStyle?: "hot" | "easy" | "value" | "longshot";
};

let pendingLaunch: CoachLaunchOpts | null = null;

export function markCoachHomeLaunch(freePreviewStyle?: CoachLaunchOpts["freePreviewStyle"]): void {
  pendingLaunch = { hideBubble: true, freshThread: true, freePreviewStyle };
}

export function takeCoachLaunch(): CoachLaunchOpts | null {
  const launch = pendingLaunch;
  pendingLaunch = null;
  return launch;
}
