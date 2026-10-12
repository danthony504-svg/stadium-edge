/**
 * Process-wide controller instance for production UI + passive diagnostics reads.
 * Diagnostics must never call boot/check/restart — only getSnapshot().
 */

import { OtaController } from "./OtaController.ts";
import { createExpoOtaClient } from "./createExpoOtaClient.ts";
import type { OtaClient } from "./types.ts";

let instance: OtaController | null = null;

export function getOtaController(): OtaController {
  if (!instance) {
    instance = new OtaController(createExpoOtaClient());
  }
  return instance;
}

/** Tests / rebuild only. */
export function resetOtaControllerForTests(client?: OtaClient): OtaController {
  instance = client ? new OtaController(client) : null;
  return getOtaController();
}

export function peekOtaController(): OtaController | null {
  return instance;
}
