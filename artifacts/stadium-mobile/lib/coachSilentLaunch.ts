/** Home one-tap launches set this synchronously before router.push (tab params may drop). */
export type CoachLaunchOpts = {
  hideBubble: boolean;
  freshThread: boolean;
  autoMsg: string;
};

let pendingLaunch: CoachLaunchOpts | null = null;

/** Queue a silent Home → Coach auto-send before tab navigation. */
export function markCoachHomeLaunch(autoMsg: string): void {
  pendingLaunch = { hideBubble: true, freshThread: true, autoMsg };
}

/** Queue any Home → Coach auto-send (shows user bubble when not silent). */
export function queueCoachAutoSend(
  autoMsg: string,
  opts?: { hideBubble?: boolean; freshThread?: boolean },
): void {
  pendingLaunch = {
    autoMsg,
    hideBubble: opts?.hideBubble ?? false,
    freshThread: opts?.freshThread ?? false,
  };
}

export function peekCoachLaunch(): CoachLaunchOpts | null {
  return pendingLaunch;
}

export function consumeCoachLaunch(): void {
  pendingLaunch = null;
}

/** @deprecated Prefer peekCoachLaunch + consumeCoachLaunch after a successful send. */
export function takeCoachLaunch(): CoachLaunchOpts | null {
  const launch = pendingLaunch;
  pendingLaunch = null;
  return launch;
}
