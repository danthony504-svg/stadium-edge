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

/** Post-Restart ledger / native classification (see otaApplyFailureClassify). */
export type OtaLaunchOutcome =
  | "unknown"
  | "launched"
  | "launch_failed"
  | "selection_failed"
  | "idle_embedded"
  | "applied_ok";

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
  /** Last Restart target written to the JS failed-launch ledger. */
  lastRestartTargetId: string | null;
  /** Reconcile / apply classification from the latest boot. */
  launchOutcome: OtaLaunchOutcome;
  launchOutcomeDetail: string | null;
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
  isEmbeddedLaunch?: () => boolean;
  isEmergencyLaunch?: () => boolean;
  emergencyLaunchReason?: () => string | null;
  /**
   * When true, native startup/relaunch has not finished. Any check/fetch/reload
   * in this window can race ErrorRecovery and mark the tip failed
   * (updatePreviouslyFailed) before RCTContentDidAppear.
   */
  isStartupProcedureRunning?: () => boolean;
  checkForUpdateAsync: () => Promise<OtaCheckResult>;
  fetchUpdateAsync: () => Promise<OtaFetchResult>;
  reloadAsync: () => Promise<void>;
};

/**
 * Persist Restart target before reloadAsync tears down JS, and reconcile on boot.
 * Injected from AsyncStorage at the singleton — controller stays pure/testable.
 */
export type OtaFailedLaunchHooks = {
  noteReloadTarget: (targetId: string) => Promise<void>;
  reconcileBoot: (runningUpdateId: string | null) => Promise<{
    observed: "no-target" | "launched" | "failed";
    failedTargetId?: string;
    failedCount?: number;
  }>;
};

export const OTA_PREVIOUSLY_FAILED = "updatePreviouslyFailed";

export const DEFAULT_FOREGROUND_COOLDOWN_MS = 45_000;
/**
 * Delay first checkForUpdateAsync after tip boot so expo-updates can mark the
 * launch successful before any Updates.* network work. Tip `01a13540` used 400ms
 * and landed in native `updatePreviouslyFailed` (failedLaunchCount>0 before
 * RCTContentDidAppear). Also wait until `isStartupProcedureRunning` is false.
 */
export const DEFAULT_LAUNCH_DELAY_MS = 3_500;
/** Max extra wait for native startup procedure after the launch delay. */
export const STARTUP_PROCEDURE_WAIT_MS = 10_000;
export const STARTUP_PROCEDURE_POLL_MS = 250;
