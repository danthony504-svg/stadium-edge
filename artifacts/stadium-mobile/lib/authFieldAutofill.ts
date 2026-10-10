/**
 * iOS Password AutoFill / Strong Password field hints for Clerk auth screens.
 *
 * Uses React Native TextInput `textContentType` (iOS) + `autoComplete` (cross-platform).
 * Email login fields use `username` so iOS pairs them with the password field in Keychain.
 * Does not weaken Clerk compromised-password (HIBP) checks — those stay server-side.
 */

export type AuthAutofillRole =
  | "emailUsername"
  | "currentPassword"
  | "newPassword"
  | "oneTimeCode";

export type AuthAutofillProps = {
  textContentType:
    | "username"
    | "password"
    | "newPassword"
    | "oneTimeCode";
  autoComplete: "username" | "password" | "new-password" | "one-time-code";
  autoCapitalize: "none";
  autoCorrect: false;
  spellCheck: false;
  /** Helps Android Autofill frameworks treat the field as fillable. */
  importantForAutofill: "yes";
};

const BASE = {
  autoCapitalize: "none" as const,
  autoCorrect: false as const,
  spellCheck: false as const,
  importantForAutofill: "yes" as const,
};

/** Email identifier paired with a password (sign-in / sign-up). */
export const AUTH_EMAIL_AUTOFILL: AuthAutofillProps = {
  ...BASE,
  textContentType: "username",
  autoComplete: "username",
};

/** Existing-account password (sign-in). */
export const AUTH_CURRENT_PASSWORD_AUTOFILL: AuthAutofillProps = {
  ...BASE,
  textContentType: "password",
  autoComplete: "password",
};

/**
 * Account-creation / reset password — enables iOS Strong Password suggestions
 * and saving to iCloud Keychain / Passwords.
 */
export const AUTH_NEW_PASSWORD_AUTOFILL: AuthAutofillProps = {
  ...BASE,
  textContentType: "newPassword",
  autoComplete: "new-password",
};

/** Email MFA / reset codes. */
export const AUTH_OTP_AUTOFILL: AuthAutofillProps = {
  ...BASE,
  textContentType: "oneTimeCode",
  autoComplete: "one-time-code",
};

export function authAutofillProps(role: AuthAutofillRole): AuthAutofillProps {
  switch (role) {
    case "emailUsername":
      return AUTH_EMAIL_AUTOFILL;
    case "currentPassword":
      return AUTH_CURRENT_PASSWORD_AUTOFILL;
    case "newPassword":
      return AUTH_NEW_PASSWORD_AUTOFILL;
    case "oneTimeCode":
      return AUTH_OTP_AUTOFILL;
    default: {
      const _exhaustive: never = role;
      return _exhaustive;
    }
  }
}
