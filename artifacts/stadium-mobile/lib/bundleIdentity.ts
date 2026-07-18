// Bundle identity — proves which commit/project/bundle the device loaded.

export const BUNDLE_PROJECT_PATH =
  process.env.EXPO_PUBLIC_PROJECT_PATH ?? "/workspace/artifacts/stadium-mobile";

export const BUNDLE_GIT_COMMIT = (
  process.env.EXPO_PUBLIC_GIT_COMMIT ?? "unknown"
).slice(0, 12);

export const BUNDLE_METRO_MODE =
  process.env.EXPO_PUBLIC_METRO_MODE ?? "tunnel-dev-client";

/** ISO timestamp captured when this JS bundle was first evaluated. */
export const BUNDLE_TIMESTAMP = new Date().toISOString();

export type BundleIdentity = {
  commit: string;
  projectPath: string;
  bundleTimestamp: string;
  dev: boolean;
  metroMode: string;
};

export function getBundleIdentity(): BundleIdentity {
  return {
    commit: BUNDLE_GIT_COMMIT,
    projectPath: BUNDLE_PROJECT_PATH,
    bundleTimestamp: BUNDLE_TIMESTAMP,
    dev: typeof __DEV__ !== "undefined" ? __DEV__ : process.env.NODE_ENV !== "production",
    metroMode: BUNDLE_METRO_MODE,
  };
}

export function formatBundleIdentityLine(requestId?: string | null): string {
  const id = getBundleIdentity();
  const modeLabel = id.dev ? "dev" : "production";
  const timeLabel = new Date(id.bundleTimestamp).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
  const reqLabel = requestId?.trim()
    ? ` • req ${requestId.trim().slice(0, 12)}`
    : "";
  return `${modeLabel} ${id.metroMode} • commit ${id.commit} • ${id.projectPath} • ${timeLabel}${reqLabel}`;
}

let logged = false;

/** Log once per bundle load — call from root layout and module init. */
export function logBundleIdentity(): void {
  if (logged) return;
  logged = true;
  const id = getBundleIdentity();
  console.log("[bundle-identity]", {
    commit: id.commit,
    projectPath: id.projectPath,
    bundleTimestamp: id.bundleTimestamp,
    dev: id.dev,
    metroMode: id.metroMode,
  });
}

logBundleIdentity();
