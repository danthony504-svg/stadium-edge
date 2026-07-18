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
  return formatCoachOtaVerificationLine();
}

/** Dev-only Metro bundle verification (Coach screen in __DEV__). */
export function formatCoachDevCommitLine(): string {
  const commit = process.env.EXPO_PUBLIC_GIT_COMMIT ?? "not-baked";
  const commitShort =
    commit === "not-baked" || commit === "unknown"
      ? commit
      : commit.length > 10
        ? `${commit.slice(0, 10)}…`
        : commit;
  return `dev Metro · commit ${commitShort}`;
}

export function coachDevCommitLabel(): string {
  return formatCoachDevCommitLine();
}

export function coachOtaCommitFull(): string {
  return process.env.EXPO_PUBLIC_GIT_COMMIT ?? "not-baked";
}

/** On-screen proof of which OTA bundle loaded (update id + baked commit + runtime). */
export function formatCoachOtaVerificationLine(): string {
  const commit = process.env.EXPO_PUBLIC_GIT_COMMIT ?? "not-baked";
  const commitShort =
    commit === "not-baked" || commit === "unknown"
      ? commit
      : commit.length > 10
        ? `${commit.slice(0, 10)}…`
        : commit;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Updates = require("expo-updates") as typeof import("expo-updates");
    const id = Updates.updateId;
    const idShort = id ? `${id.slice(0, 8)}…` : "embedded";
    const rt = Updates.runtimeVersion ?? "?";
    const mode = Updates.isEmbeddedLaunch ? "embedded" : "ota";
    return `upd ${idShort} · commit ${commitShort} · rt ${rt} · ${mode}`;
  } catch {
    return `commit ${commitShort}`;
  }
}
