import {
  STARTUP_PROCEDURE_POLL_MS,
  STARTUP_PROCEDURE_WAIT_MS,
} from "./types.ts";

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wait until expo-updates reports startup procedure idle, or timeout.
 * Prevents the tip-boot Updates I/O race that blacklisted `01a13540`.
 * Pure — safe for node:test (no react-native import).
 */
export async function waitForStartupProcedureIdle(
  isRunning: () => boolean,
  opts?: {
    maxMs?: number;
    pollMs?: number;
    sleepFn?: (ms: number) => Promise<void>;
  },
): Promise<"idle" | "timeout"> {
  const maxMs = opts?.maxMs ?? STARTUP_PROCEDURE_WAIT_MS;
  const pollMs = opts?.pollMs ?? STARTUP_PROCEDURE_POLL_MS;
  const sleepFn = opts?.sleepFn ?? defaultSleep;
  if (!isRunning()) return "idle";
  const deadline = Date.now() + maxMs;
  while (isRunning()) {
    if (Date.now() >= deadline) return "timeout";
    await sleepFn(pollMs);
  }
  return "idle";
}
