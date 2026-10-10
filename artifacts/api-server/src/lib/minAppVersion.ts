/**
 * Server-controlled minimum supported native app versions.
 * Env overrides allow ops to raise the floor without a code deploy.
 */

export const DEFAULT_MIN_IOS_VERSION = "1.1.0";
export const APP_STORE_IOS_URL = "https://apps.apple.com/app/id6776024127";

/** Compare dotted semver-like strings (1.0.3 vs 1.1.0). Non-numeric → 0. */
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
  return compareAppVersions(current, minimum) < 0;
}

export function getMinIosVersion(): string {
  const fromEnv = (process.env.MIN_IOS_APP_VERSION ?? "").trim();
  return fromEnv || DEFAULT_MIN_IOS_VERSION;
}

/**
 * 426 enforcement is OFF by default until the 1.0.3 force-update OTA path is
 * verified. Set MIN_IOS_VERSION_ENFORCEMENT=true to enable API blocking.
 * /app/config remains available either way.
 */
export function isMinIosVersionEnforcementEnabled(): boolean {
  return (process.env.MIN_IOS_VERSION_ENFORCEMENT ?? "").trim().toLowerCase() === "true";
}

export type AppConfigPayload = {
  minIosVersion: string;
  appStoreUrl: string;
  updateRequiredMessage: string;
};

export function buildAppConfigPayload(): AppConfigPayload {
  const minIosVersion = getMinIosVersion();
  return {
    minIosVersion,
    appStoreUrl: APP_STORE_IOS_URL,
    updateRequiredMessage:
      "Stadium Edge requires version 1.1.0 or later. Please update from the App Store to continue.",
  };
}

/**
 * Paths that must remain reachable for outdated clients:
 * health, min-version config, subscriptions (restore), App Review auth helpers.
 */
export function isMinVersionExemptPath(path: string): boolean {
  const p = (path.split("?")[0] ?? path).replace(/\/+$/, "") || "/";
  if (p === "/health" || p === "/healthz" || p.endsWith("/health") || p.endsWith("/healthz")) {
    return true;
  }
  if (p === "/app/config" || p.endsWith("/app/config")) return true;
  if (p.includes("/subscriptions")) return true;
  // App Review ticket helper is /auth/app-review-ticket (not /app-review/…).
  if (p.includes("/app-review") || p.includes("/auth/app-review")) return true;
  // Crash ingest must work even when the binary is below the floor.
  if (p.includes("/reliability/crashes")) return true;
  return false;
}
