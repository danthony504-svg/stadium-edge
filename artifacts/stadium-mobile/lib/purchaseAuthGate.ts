/**
 * Pure auth gates for StoreKit purchase / restore entry points.
 */

export type BillingAuthState = {
  /** Clerk useAuth().isLoaded */
  authLoaded: boolean;
  isSignedIn: boolean;
  /** Clerk user id — required before RevenueCat identify / purchase. */
  userId: string | null | undefined;
};

export type BillingAuthGateResult =
  | { ok: true; userId: string }
  | {
      ok: false;
      reason: "auth_loading" | "signed_out" | "missing_user_id";
      message: string;
    };

/** True when purchase/restore CTAs must be disabled. */
export function isBillingAuthBlocked(state: BillingAuthState): boolean {
  return !resolveBillingAuth(state).ok;
}

export function resolveBillingAuth(
  state: BillingAuthState,
): BillingAuthGateResult {
  if (!state.authLoaded) {
    return {
      ok: false,
      reason: "auth_loading",
      message: "Checking your account…",
    };
  }
  if (!state.isSignedIn) {
    return {
      ok: false,
      reason: "signed_out",
      message: "Sign in to subscribe or restore purchases.",
    };
  }
  const userId = typeof state.userId === "string" ? state.userId.trim() : "";
  if (!userId) {
    return {
      ok: false,
      reason: "missing_user_id",
      message: "Sign in to subscribe or restore purchases.",
    };
  }
  return { ok: true, userId };
}

/**
 * After a StoreKit success, only unlock UI when the server confirms a paid plan.
 * Never grant from client email / review flags here.
 */
export function shouldUnlockFromServerVerify(verified: {
  ok: boolean;
  storeKitActive: boolean;
  planId: string | null;
}): verified is { ok: true; storeKitActive: true; planId: "go" | "pro" } {
  return (
    verified.ok === true &&
    verified.storeKitActive === true &&
    (verified.planId === "go" || verified.planId === "pro")
  );
}
