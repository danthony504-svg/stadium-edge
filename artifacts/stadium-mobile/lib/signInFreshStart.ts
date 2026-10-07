/**
 * Sign-in MFA gate helpers — keep Verify from appearing on stale Clerk state.
 * Pure functions so Node tests can lock the Build 78 regression without RN.
 */

export type ClerkSignInStatus = string | null | undefined;

export function isSecondFactorStatus(status: ClerkSignInStatus): boolean {
  return status === "needs_second_factor" || status === "needs_client_trust";
}

/** Verify UI only after this visit's credential submit armed the gate. */
export function shouldShowVerifyScreen(
  awaitingSecondFactor: boolean,
  status: ClerkSignInStatus,
): boolean {
  return awaitingSecondFactor && isSecondFactorStatus(status);
}

export type FreshSignInLocalState = {
  emailAddress: string;
  code: string;
  formError: string;
  awaitingSecondFactor: boolean;
  mode: "signin";
};

/** Local fields cleared when opening Sign in for a fresh visit. */
export function freshSignInLocalState(): FreshSignInLocalState {
  return {
    emailAddress: "",
    code: "",
    formError: "",
    awaitingSecondFactor: false,
    mode: "signin",
  };
}

/**
 * After password/biometric succeeds: arm Verify only when Clerk asks for
 * second factor / client trust on this attempt.
 */
export function shouldArmSecondFactor(status: ClerkSignInStatus): boolean {
  return isSecondFactorStatus(status);
}
