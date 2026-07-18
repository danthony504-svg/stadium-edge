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
  if (full === "not-baked" || full === "unknown") return full;
  return full.length > 12 ? `${full.slice(0, 12)}…` : full;
}

export function coachOtaCommitFull(): string {
  return process.env.EXPO_PUBLIC_GIT_COMMIT ?? "not-baked";
}
