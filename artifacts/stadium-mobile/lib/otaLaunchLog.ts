/**
 * In-memory OTA launch log for on-device diagnostics (no native build required).
 */

export type OtaLogEntry = {
  ts: string;
  step: "checkForUpdateAsync" | "fetchUpdateAsync" | "reloadAsync";
  ok: boolean;
  detail: string;
};

const MAX = 24;
const logs: OtaLogEntry[] = [];
const listeners = new Set<() => void>();

export function pushOtaLog(
  step: OtaLogEntry["step"],
  ok: boolean,
  detail: string,
): void {
  logs.push({ ts: new Date().toISOString(), step, ok, detail });
  while (logs.length > MAX) logs.shift();
  for (const fn of listeners) fn();
}

export function getOtaLaunchLogs(): readonly OtaLogEntry[] {
  return logs;
}

export function subscribeOtaLaunchLogs(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function formatOtaLogLines(): string[] {
  return logs.map((e) => `${e.ts} ${e.ok ? "OK" : "ERR"} ${e.step}: ${e.detail}`);
}
