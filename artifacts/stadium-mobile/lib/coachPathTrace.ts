/** Temporary path-tracing logs — grep Metro for `[coach-path]`. */

export type CoachPathTraceEvent =
  | "SCAN_STARTED"
  | "SCAN_PARTIAL"
  | "SCAN_FINAL_PUBLISHED"
  | "EMPTY_SCAN_TERMINAL"
  | "SCAN_TIMEOUT"
  | "UI_RENDER_PICKS";

export function traceCoachPath(
  event: CoachPathTraceEvent,
  detail?: Record<string, unknown>,
): void {
  if (detail && Object.keys(detail).length > 0) {
    console.log(`[coach-path] ${event}`, JSON.stringify(detail));
  } else {
    console.log(`[coach-path] ${event}`);
  }
}

/** Short hash for on-screen OTA verification. */
export function coachOtaCommitLabel(): string {
  const full = process.env.EXPO_PUBLIC_GIT_COMMIT ?? "not-baked";
  if (full !== "not-baked" && full !== "unknown") {
    return full.length > 12 ? `${full.slice(0, 12)}…` : full;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Updates = require("expo-updates") as typeof import("expo-updates");
    const id = Updates.updateId;
    if (id) return `upd ${id.slice(0, 8)}…`;
    if (Updates.isEmbeddedLaunch) return "embedded";
  } catch {
    // expo-updates unavailable (Expo Go / dev)
  }
  return full;
}

export function coachOtaCommitFull(): string {
  return process.env.EXPO_PUBLIC_GIT_COMMIT ?? "not-baked";
}
