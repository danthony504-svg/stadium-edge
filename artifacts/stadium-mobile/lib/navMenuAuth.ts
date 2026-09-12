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

/** Production side menu must not bury Sign in under debug entries. */
export function shouldShowOtaDiagnosticsMenuItem(isDev: boolean): boolean {
  return isDev;
}
