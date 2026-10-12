/**
 * Pure open-path network policy for /ota-debug.
 * Mirrors collectOtaStaticDiagnostics / probe gates without pulling the full
 * otaDebug import graph (extensionless RN modules) into node:test.
 */

import { canRunLiveOtaProbe } from "./otaDebugOpenPolicy.ts";

export type OtaDebugNetworkSpy = {
  checkForUpdateAsync: () => Promise<unknown>;
  fetchUpdateAsync: () => Promise<unknown>;
  reloadAsync: () => Promise<unknown>;
  readLogEntriesAsync: () => Promise<unknown>;
};

export type OtaDebugNetworkCounts = {
  checkForUpdateAsync: number;
  fetchUpdateAsync: number;
  reloadAsync: number;
  readLogEntriesAsync: number;
};

export function createOtaDebugNetworkSpy(): {
  spy: OtaDebugNetworkSpy;
  counts: OtaDebugNetworkCounts;
} {
  const counts: OtaDebugNetworkCounts = {
    checkForUpdateAsync: 0,
    fetchUpdateAsync: 0,
    reloadAsync: 0,
    readLogEntriesAsync: 0,
  };
  return {
    counts,
    spy: {
      checkForUpdateAsync: async () => {
        counts.checkForUpdateAsync += 1;
      },
      fetchUpdateAsync: async () => {
        counts.fetchUpdateAsync += 1;
      },
      reloadAsync: async () => {
        counts.reloadAsync += 1;
      },
      readLogEntriesAsync: async () => {
        counts.readLogEntriesAsync += 1;
      },
    },
  };
}

/**
 * Exact network actions allowed when /ota-debug mounts (or deep-links).
 * Must perform zero check/fetch/reload. Skips readLogEntries while startup runs.
 */
export async function runOtaDebugOpenStaticPath(opts: {
  isStartupProcedureRunning: boolean;
  spy: OtaDebugNetworkSpy;
}): Promise<void> {
  if (!opts.isStartupProcedureRunning) {
    await opts.spy.readLogEntriesAsync();
  }
  // No checkForUpdateAsync / fetchUpdateAsync / reloadAsync on open.
}

/**
 * Exact network actions when the user taps "Run live OTA probe".
 * Blocked entirely while startup is running.
 */
export async function runOtaDebugLiveProbePath(opts: {
  isStartupProcedureRunning: boolean;
  spy: OtaDebugNetworkSpy;
}): Promise<"ran" | "blocked"> {
  if (!canRunLiveOtaProbe(opts.isStartupProcedureRunning)) return "blocked";
  await opts.spy.checkForUpdateAsync();
  return "ran";
}
