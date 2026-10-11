/**
 * Pure helpers for Clerk WebAuthn passkeys on Expo.
 *
 * Passkeys are a first-class Clerk auth method (separate from the SecureStore
 * email/password biometric shortcut in biometricLogin.ts). A passkey user does
 * not need to know or remember a password — when Clerk still requires a
 * password field at sign-up we generate a machine secret the UI never shows.
 */

/** Clerk / native cancellation & abort codes that must not freeze the UI. */
const PASSKEY_CANCEL_CODES = new Set([
  "passkey_registration_cancelled",
  "passkey_retrieval_cancelled",
  "passkey_operation_aborted",
  "ERROR_CANCELLED",
  "ERR_CANCELLED",
  "ERR_REQUEST_CANCELED",
]);

/** Clerk codes that mean the email already belongs to an account. */
const DUPLICATE_EMAIL_CODES = new Set(["form_identifier_exists"]);

const DUPLICATE_EMAIL_MESSAGE =
  "An account with this email already exists. Sign in instead.";

export type PasskeyErrorKind =
  | "cancelled"
  | "duplicate_email"
  | "unsupported"
  | "already_exists"
  | "invalid_domain"
  | "failed";

/** Build a Clerk-safe password from opaque random bytes (testable). */
export function machinePasswordFromBytes(raw: Uint8Array): string {
  let out = "";
  for (let i = 0; i < raw.length; i++) {
    out += (raw[i]! % 36).toString(36);
  }
  // Guarantee complexity: mix case + digit + symbol without exposing to UI.
  return `Pk!${out}A1`;
}

export function generateMachinePassword(bytes = 32): string {
  // URL-safe random secret; never shown to the user. Satisfies Clerk password
  // requirements when password is still a required sign-up attribute.
  const raw = new Uint8Array(bytes);
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(raw);
  } else {
    for (let i = 0; i < bytes; i++) raw[i] = (Math.random() * 256) | 0;
  }
  return machinePasswordFromBytes(raw);
}

export function extractClerkErrorCode(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const e = error as {
    code?: string;
    errors?: Array<{ code?: string }>;
    error?: { code?: string };
  };
  if (typeof e.code === "string" && e.code) return e.code;
  const nested = e.errors?.[0]?.code ?? e.error?.code;
  return typeof nested === "string" && nested ? nested : null;
}

export function extractClerkErrorMessage(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const e = error as {
    message?: string;
    longMessage?: string;
    errors?: Array<{ message?: string; longMessage?: string }>;
  };
  const first = e.errors?.[0];
  const msg = first?.longMessage || first?.message || e.longMessage || e.message;
  return typeof msg === "string" && msg.trim() ? msg.trim() : null;
}

export function classifyPasskeyError(error: unknown): PasskeyErrorKind {
  const code = extractClerkErrorCode(error);
  if (code && PASSKEY_CANCEL_CODES.has(code)) return "cancelled";
  if (code && DUPLICATE_EMAIL_CODES.has(code)) return "duplicate_email";
  if (code === "passkey_not_supported" || code === "passkey_pa_not_supported") {
    return "unsupported";
  }
  if (code === "passkey_already_exists") return "already_exists";
  if (code === "passkey_invalid_rpID_or_domain") return "invalid_domain";

  const msg = (extractClerkErrorMessage(error) || "").toLowerCase();
  if (
    msg.includes("cancel") ||
    msg.includes("cancelled") ||
    msg.includes("canceled") ||
    msg.includes("abort")
  ) {
    return "cancelled";
  }
  if (msg.includes("already exists") || msg.includes("identifier_exists")) {
    return "duplicate_email";
  }
  return "failed";
}

export function isPasskeyCancellation(error: unknown): boolean {
  return classifyPasskeyError(error) === "cancelled";
}

export function isDuplicateEmailError(error: unknown): boolean {
  const code = extractClerkErrorCode(error);
  if (code && DUPLICATE_EMAIL_CODES.has(code)) return true;
  if (code === "form_identifier_exists") return true;
  const msg = (extractClerkErrorMessage(error) || "").toLowerCase();
  return msg.includes("already exists") || msg.includes("taken");
}

/** User-facing copy for passkey create / sign-in failures. Never throws. */
export function describePasskeyError(
  error: unknown,
  action: "sign_in" | "sign_up" | "create" = "sign_in",
): string {
  const kind = classifyPasskeyError(error);
  switch (kind) {
    case "cancelled":
      return action === "create" || action === "sign_up"
        ? "Passkey setup was cancelled. You can try again anytime."
        : "Passkey sign-in was cancelled.";
    case "duplicate_email":
      return DUPLICATE_EMAIL_MESSAGE;
    case "unsupported":
      return "Passkeys aren't available on this device.";
    case "already_exists":
      return "A passkey for this account is already on this device. Try Sign in with Passkey.";
    case "invalid_domain":
      return "Passkeys aren't configured for this app build yet. Use email and password, or update the app.";
    default: {
      const detail = extractClerkErrorMessage(error);
      if (detail && !detail.toLowerCase().includes("unknown")) return detail;
      return action === "sign_in"
        ? "Couldn't sign in with passkey. Please try again."
        : "Couldn't create a passkey. Please try again.";
    }
  }
}

export function describeSignupError(error: unknown): string {
  if (isDuplicateEmailError(error)) return DUPLICATE_EMAIL_MESSAGE;
  return (
    extractClerkErrorMessage(error) ||
    "Couldn't create your account. Please try again."
  );
}

/**
 * Decode the Frontend API host from a Clerk publishable key
 * (`pk_test_<base64>` / `pk_live_<base64>` → `host$`).
 */
export function clerkFrontendApiHost(publishableKey: string): string | null {
  const m = publishableKey.match(/^pk_(?:test|live)_(.+)$/);
  if (!m?.[1]) return null;
  try {
    // atob is available in RN Hermes / Expo.
    const decoded = globalThis.atob(m[1]);
    const host = decoded.replace(/\$$/, "").trim();
    return host.includes(".") ? host : null;
  } catch {
    return null;
  }
}

/** Associated Domains entries for Expo `ios.associatedDomains`. */
export function clerkAssociatedDomains(publishableKey: string): string[] {
  const host = clerkFrontendApiHost(publishableKey);
  if (!host) return [];
  return [`applinks:${host}`, `webcredentials:${host}`];
}
