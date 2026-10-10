/**
 * Native app version helpers (pure — Node-testable).
 */

export const EMBEDDED_MIN_IOS_VERSION = "1.1.0";
export const APP_STORE_IOS_URL = "https://apps.apple.com/app/id6776024127";

export function compareAppVersions(a: string, b: string): number {
  const pa = String(a ?? "")
    .trim()
    .replace(/^v/i, "")
    .split(/[.+-]/)
    .map((x) => {
      const n = Number.parseInt(x, 10);
      return Number.isFinite(n) ? n : 0;
    });
  const pb = String(b ?? "")
    .trim()
    .replace(/^v/i, "")
    .split(/[.+-]/)
    .map((x) => {
      const n = Number.parseInt(x, 10);
      return Number.isFinite(n) ? n : 0;
    });
  const len = Math.max(pa.length, pb.length, 3);
  for (let i = 0; i < len; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

export function isAppVersionBelow(current: string, minimum: string): boolean {
  if (!current || !String(current).trim()) return false;
  if (!minimum || !String(minimum).trim()) return false;
  return compareAppVersions(current, minimum) < 0;
}

export type ForceUpdateDecision = {
  required: boolean;
  currentVersion: string;
  minIosVersion: string;
  appStoreUrl: string;
  message: string;
};

/**
 * Decide whether to block the app. Server config wins when present;
 * offline / server failure: fail-open for current clients (do not brick 1.1.0).
 * When `preferEmbeddedFloor` is true (dedicated 1.0.3 force-update OTA), use
 * the embedded 1.1.0 floor if the server cannot be reached.
 */
export function decideForceUpdate(opts: {
  currentVersion: string;
  serverMinIosVersion?: string | null;
  serverAppStoreUrl?: string | null;
  serverMessage?: string | null;
  serverReachable: boolean;
  preferEmbeddedFloor?: boolean;
}): ForceUpdateDecision {
  const currentVersion = String(opts.currentVersion ?? "").trim() || "0.0.0";
  const appStoreUrl = opts.serverAppStoreUrl?.trim() || APP_STORE_IOS_URL;
  const message =
    opts.serverMessage?.trim() ||
    "Stadium Edge requires version 1.1.0 or later. Please update from the App Store to continue.";

  let minIosVersion = EMBEDDED_MIN_IOS_VERSION;
  if (opts.serverReachable && opts.serverMinIosVersion?.trim()) {
    minIosVersion = opts.serverMinIosVersion.trim();
  } else if (!opts.serverReachable && !opts.preferEmbeddedFloor) {
    return {
      required: false,
      currentVersion,
      minIosVersion,
      appStoreUrl,
      message,
    };
  }

  return {
    required: isAppVersionBelow(currentVersion, minIosVersion),
    currentVersion,
    minIosVersion,
    appStoreUrl,
    message,
  };
}
