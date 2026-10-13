/**
 * Process-wide controller instance for production UI + passive diagnostics reads.
 * Diagnostics must never call boot/check/restart — only getSnapshot().
 */

import {
  OTA_FAILED_LAUNCH_KEY,
  noteReloadTarget,
  reconcileLaunch,
  readFailedLaunchRecord,
  writeFailedLaunchRecord,
  type OtaFailedLaunchStorage,
} from "../otaFailedLaunch.ts";
import { OtaController } from "./OtaController.ts";
import { createExpoOtaClient } from "./createExpoOtaClient.ts";
import type { OtaClient, OtaFailedLaunchHooks } from "./types.ts";

let instance: OtaController | null = null;

function createAsyncStorageLedger(): OtaFailedLaunchStorage {
  return {
    async read() {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const AsyncStorage = require("@react-native-async-storage/async-storage")
          .default as { getItem: (k: string) => Promise<string | null> };
        return await AsyncStorage.getItem(OTA_FAILED_LAUNCH_KEY);
      } catch {
        return null;
      }
    },
    async write(raw: string) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const AsyncStorage = require("@react-native-async-storage/async-storage")
          .default as { setItem: (k: string, v: string) => Promise<void> };
        await AsyncStorage.setItem(OTA_FAILED_LAUNCH_KEY, raw);
      } catch {
        // best-effort
      }
    },
  };
}

function createFailedLaunchHooks(): OtaFailedLaunchHooks {
  const storage = createAsyncStorageLedger();
  return {
    async noteReloadTarget(targetId: string) {
      const record = await readFailedLaunchRecord(storage);
      await writeFailedLaunchRecord(storage, noteReloadTarget(record, targetId));
    },
    async reconcileBoot(runningUpdateId: string | null) {
      const record = await readFailedLaunchRecord(storage);
      const result = reconcileLaunch(record, runningUpdateId);
      await writeFailedLaunchRecord(storage, result.record);
      return {
        observed: result.observed,
        failedTargetId: result.failedTargetId,
        failedCount: result.failedCount,
      };
    },
  };
}

export function getOtaController(): OtaController {
  if (!instance) {
    instance = new OtaController(createExpoOtaClient(), {
      failedLaunchHooks: createFailedLaunchHooks(),
    });
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
