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

/** Production side menu must not bury Sign in under debug entries. */
export function shouldShowOtaDiagnosticsMenuItem(isDev: boolean): boolean {
  return isDev;
}
