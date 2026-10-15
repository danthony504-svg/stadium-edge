/**
 * Home / deep-link Coach launches set this synchronously before router.push.
 * Expo tab/stack navigations can drop query params — the module queue keeps
 * autoMsg so Coach still auto-sends after landing.
 */
export type CoachLaunchOpts = {
  /** Hide the user bubble for silent home one-taps. */
  hideBubble: boolean;
  /** Abort prior thread and start from the welcome card. */
  freshThread: boolean;
  /** Message to auto-send once Coach mounts (survives param drop). */
  autoMsg?: string | null;
};

let pendingLaunch: CoachLaunchOpts | null = null;

export function markCoachHomeLaunch(opts?: {
  autoMsg?: string | null;
  hideBubble?: boolean;
  freshThread?: boolean;
}): void {
  pendingLaunch = {
    hideBubble: opts?.hideBubble ?? true,
    freshThread: opts?.freshThread ?? true,
    autoMsg: opts?.autoMsg ?? null,
  };
}

export function takeCoachLaunch(): CoachLaunchOpts | null {
  const launch = pendingLaunch;
  pendingLaunch = null;
  return launch;
}

/** Test helper — clear any leftover launch between cases. */
export function resetCoachLaunchForTests(): void {
  pendingLaunch = null;
}
