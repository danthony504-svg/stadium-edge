export { OtaController, computeBannerVisible } from "./OtaController.ts";
export { createExpoOtaClient } from "./createExpoOtaClient.ts";
export {
  getOtaController,
  peekOtaController,
  resetOtaControllerForTests,
} from "./otaControllerSingleton.ts";
export { useOtaController } from "./useOtaController.ts";
export { waitForStartupProcedureIdle } from "./waitForStartupProcedureIdle.ts";
export type {
  OtaCheckResult,
  OtaClient,
  OtaFailedLaunchHooks,
  OtaFetchResult,
  OtaLaunchOutcome,
  OtaSnapshot,
  OtaState,
} from "./types.ts";
export {
  DEFAULT_FOREGROUND_COOLDOWN_MS,
  DEFAULT_LAUNCH_DELAY_MS,
  OTA_PREVIOUSLY_FAILED,
  STARTUP_PROCEDURE_POLL_MS,
  STARTUP_PROCEDURE_WAIT_MS,
} from "./types.ts";
