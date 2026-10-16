/**
 * Pure helpers for NavMenu account / diagnostics visibility (Node-testable).
 */

export function accountMenuItem(isSignedIn: boolean): {
  route: "/account" | "/sign-in";
  label: "Account" | "Sign in";
  icon: "user-check" | "log-in";
} {
  if (isSignedIn) {
    return { route: "/account", label: "Account", icon: "user-check" };
  }
  return { route: "/sign-in", label: "Sign in", icon: "log-in" };
}

/**
 * Soft Plans entry — always reachable for guests and signed-in users.
 * Does not replace Sign in; sits above account auth so App Store 5.1.1(v)
 * guest browsing stays intact.
 */
export function plansMenuItem(): {
  route: "/plans";
  label: "Plans";
  icon: "zap";
} {
  return { route: "/plans", label: "Plans", icon: "zap" };
}

/**
 * Normalize Expo channel strings for Device attestation UI gating.
 * Pure — safe for node:test (no expo-updates import).
 */
export function normalizeOtaChannelName(
  channel: string | null | undefined,
): string {
  return String(channel ?? "")
    .toLowerCase()
    .trim();
}

/**
 * Device attestation entry points (Home card + Nav menu) are preview/dev only.
 * Hidden on the production channel so App Store Build 78 users do not see the
 * temporary diagnostics strip — no empty spacing when hidden.
 *
 * Diagnostics route `/ota-debug`, OTA recovery banners, passkey guards, and
 * Coach behavior are unchanged; this only gates the two UI entry points.
 */
export function shouldShowDeviceAttestationUi(opts: {
  isDev: boolean;
  channel?: string | null;
}): boolean {
  if (opts.isDev) return true;
  const ch = normalizeOtaChannelName(opts.channel);
  if (ch === "preview" || ch === "development") return true;
  // Explicit production (and blank/unknown on release binaries) stay hidden.
  return false;
}

/** @deprecated Prefer {@link shouldShowDeviceAttestationUi} with channel. */
export function shouldShowOtaDiagnosticsMenuItem(
  isDev: boolean,
  channel?: string | null,
): boolean {
  return shouldShowDeviceAttestationUi({ isDev, channel });
}
