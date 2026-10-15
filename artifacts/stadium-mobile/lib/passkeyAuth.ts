/**
 * Pure helpers for Clerk WebAuthn passkeys on Expo.
 *
 * Passkeys are a first-class Clerk auth method (separate from the SecureStore
 * email/password biometric shortcut in biometricLogin.ts). A passkey user does
 * not need to know or remember a password — when Clerk still requires a
 * password field at sign-up we generate a machine secret the UI never shows.
 *
 * IMPORTANT: Never statically `import { passkeys } from "@clerk/expo/passkeys"`
 * at app startup. On Build 78 the native module `ClerkExpoPasskeys` is absent;
 * a static import evaluates the package immediately and throws
 * `Cannot find native module 'ClerkExpoPasskeys'`, which expo-updates marks as
 * a failed launch (`updatePreviouslyFailed`). Always use `getPasskeys()` /
 * `isPasskeysSupported()` so missing native code fail-softs to null/false.
 */

/** Minimal surface used by ClerkProvider + auth screens. */
export type PasskeysApi = {
  isSupported: () => boolean;
};

type PasskeysModuleShape =
  | { passkeys?: PasskeysApi; default?: PasskeysApi }
  | PasskeysApi;

type PasskeysLoader = () => PasskeysModuleShape;

/**
 * True only when the native binary linked ClerkExpoPasskeys.
 * Must run BEFORE require("@clerk/expo/passkeys") — that package calls
 * requireNativeModule("ClerkExpoPasskeys") at module scope and throws on
 * Build 78 (embedded IPA has zero ClerkExpoPasskeys symbols).
 *
 * Prefer expo-modules-core optional lookup (Expo modules often omit classic
 * NativeModules bridge entries); fall back to NativeModules when needed.
 */
export function hasClerkExpoPasskeysNative(): boolean {
  if (nativePresentChecker) return nativePresentChecker();
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const emc = require("expo-modules-core") as {
      requireOptionalNativeModule?: (name: string) => unknown;
    };
    if (typeof emc.requireOptionalNativeModule === "function") {
      return emc.requireOptionalNativeModule("ClerkExpoPasskeys") != null;
    }
  } catch {
    // expo-modules-core unavailable (node tests) — try RN bridge next.
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const rn = require("react-native") as {
      NativeModules?: Record<string, unknown>;
      Platform?: { OS?: string };
    };
    if (rn.Platform?.OS === "web") return false;
    return !!rn.NativeModules?.ClerkExpoPasskeys;
  } catch {
    // Node / non-RN: cannot prove presence — allow loader (getPasskeys catch).
    return true;
  }
}

function defaultPasskeysLoader(): PasskeysModuleShape {
  // Fail closed BEFORE require — package init calls requireNativeModule at
  // top level (same pattern as purchases.ts + RNPurchases).
  if (!hasClerkExpoPasskeysNative()) {
    throw new Error("Cannot find native module 'ClerkExpoPasskeys'");
  }
  // Dynamic require — static import crashes when ClerkExpoPasskeys is missing.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("@clerk/expo/passkeys") as PasskeysModuleShape;
}

let passkeysLoader: PasskeysLoader = defaultPasskeysLoader;
let cachedPasskeys: PasskeysApi | null | undefined;
let nativePresentChecker: (() => boolean) | null = null;

function unwrapPasskeys(mod: PasskeysModuleShape): PasskeysApi | null {
  if (!mod || typeof mod !== "object") return null;
  const candidate =
    "passkeys" in mod && mod.passkeys
      ? mod.passkeys
      : "default" in mod && mod.default
        ? mod.default
        : (mod as PasskeysApi);
  if (candidate && typeof candidate.isSupported === "function") return candidate;
  return null;
}

/**
 * Lazily load Clerk passkeys. Returns null when the JS package or native
 * `ClerkExpoPasskeys` module is unavailable (safe for OTA onto older binaries).
 */
export function getPasskeys(): PasskeysApi | null {
  if (cachedPasskeys !== undefined) return cachedPasskeys;
  // Never evaluate @clerk/expo/passkeys when Build 78 (or any binary) lacks
  // ClerkExpoPasskeys — package top-level requireNativeModule would throw.
  if (!hasClerkExpoPasskeysNative()) {
    cachedPasskeys = null;
    return null;
  }
  try {
    cachedPasskeys = unwrapPasskeys(passkeysLoader());
  } catch {
    cachedPasskeys = null;
  }
  return cachedPasskeys;
}

/** True only when the native passkeys module loaded and reports support. */
export function isPasskeysSupported(): boolean {
  try {
    const api = getPasskeys();
    return Boolean(api?.isSupported?.());
  } catch {
    return false;
  }
}

/** Test-only: inject a loader (or null to restore default) and clear cache. */
export function __setPasskeysLoaderForTests(next: PasskeysLoader | null): void {
  passkeysLoader = next ?? defaultPasskeysLoader;
  cachedPasskeys = undefined;
}

/** Test-only: inject native-module presence (or null to restore). */
export function __setPasskeysNativePresentForTests(
  next: (() => boolean) | null,
): void {
  nativePresentChecker = next;
  cachedPasskeys = undefined;
}

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
