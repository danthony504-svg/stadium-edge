/**
 * Pure policy for /ota-debug open vs live probe.
 * No expo-updates / RN imports — safe for node:test.
 */

/** Shown on the live-probe button while native startup is still running. */
export const LIVE_PROBE_STARTUP_WAIT_MESSAGE =
  "Wait for startup to finish before running live probe.";

/**
 * Live check/fetch/reload is forbidden while Expo's startup procedure is
 * running — that is the crash window observed on physical devices
 * (isStartupProcedureRunning=true → checkForUpdateAsync → abort).
 */
export function canRunLiveOtaProbe(isStartupProcedureRunning: boolean): boolean {
  return !isStartupProcedureRunning;
}

/** Idle checkResult copy — must never be "loading…" (that implied auto-probe). */
export const OTA_DEBUG_IDLE_CHECK_RESULT = 'not run — tap “Run live OTA probe”';
