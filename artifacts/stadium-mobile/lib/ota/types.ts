/**
 * Stadium Edge OTA — single source of truth.
 * No legacy pending/ready flags compete with these states.
 */

export type OtaState =
  | "idle"
  | "checking"
  | "downloading"
  | "ready"
  | "restarting"
  | "error";

export type OtaSnapshot = {
  state: OtaState;
  runningUpdateId: string | null;
  discoveredUpdateId: string | null;
  downloadedUpdateId: string | null;
  lastError: string | null;
  /** Last Expo update id that failed to launch (never auto-retried). */
  failedUpdateId: string | null;
  lastCheckedAt: number | null;
  /**
   * Banner may show only when true.
   * Equivalent to: state === "ready" && downloadedUpdateId != runningUpdateId
   */
  bannerVisible: boolean;
};

export type OtaCheckResult = {
  isAvailable: boolean;
  reason?: string | null;
  manifestId?: string | null;
};

export type OtaFetchResult = {
  isNew?: boolean;
  manifestId?: string | null;
};

/** Injectable Expo Updates surface — UI never talks to expo-updates directly. */
export type OtaClient = {
  getRunningUpdateId: () => string | null;
  getDownloadedUpdateId: () => string | null;
  isEnabled: () => boolean;
  checkForUpdateAsync: () => Promise<OtaCheckResult>;
  fetchUpdateAsync: () => Promise<OtaFetchResult>;
  reloadAsync: () => Promise<void>;
};

export const OTA_PREVIOUSLY_FAILED = "updatePreviouslyFailed";

export const DEFAULT_FOREGROUND_COOLDOWN_MS = 45_000;
export const DEFAULT_LAUNCH_DELAY_MS = 400;
