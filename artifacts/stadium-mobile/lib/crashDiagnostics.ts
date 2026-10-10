/**
 * Production-safe crash diagnostics for ErrorFallback.
 * Never import expo-updates here — ErrorFallback sits in the root static graph.
 */

export type CrashOtaIdentity = {
  updateId: string;
  runtimeVersion: string;
  channel: string;
  bundleSource: "ota" | "embedded" | "unknown";
  isEmbeddedLaunch: boolean;
  isEmergencyLaunch: boolean;
  /** True when the failed-launch ledger or native recovery marks a refused update. */
  updatePreviouslyFailed: boolean;
  failedLaunchCount: number;
};

const REDACT = "[redacted]";

/** Patterns that must never appear in copyable crash text. */
const SECRET_PATTERNS: RegExp[] = [
  /\bBearer\s+[A-Za-z0-9._\-+=\/]+/gi,
  /\bAuthorization:\s*\S+/gi,
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, // JWT
  /\b(sk|pk)_(live|test)_[A-Za-z0-9]+\b/g, // Clerk publishable/secret-shaped
  /\bappl_v\d+_[A-Za-z0-9]+\b/gi, // RevenueCat iOS API key shape
  /\bgoog_[A-Za-z0-9]+\b/gi, // RevenueCat Google key shape
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, // emails
  /\b(password|passwd|secret|token|api[_-]?key|refresh[_-]?token)\s*[:=]\s*\S+/gi,
  /\bstadium-edge:[^\s"']+/gi, // AsyncStorage key payloads in stacks
  /\buser_[A-Za-z0-9]{20,}\b/g, // Clerk user ids
  /\bsess_[A-Za-z0-9]{20,}\b/g,
  // Long base64-ish blobs that often carry session/API payloads in stacks.
  /\b[A-Za-z0-9+\/=]{80,}\b/g,
];

export function sanitizeCrashText(input: string | null | undefined, maxLen = 2400): string {
  if (!input) return "—";
  let out = String(input);
  for (const re of SECRET_PATTERNS) {
    out = out.replace(re, REDACT);
  }
  // Collapse absolute device paths to basename-ish frames when possible.
  out = out.replace(/\/var\/mobile\/Containers\/[^\s)]+/g, "[app-container]");
  out = out.replace(/file:\/\/[^\s)]+/g, "[file]");
  if (out.length > maxLen) out = `${out.slice(0, maxLen)}…`;
  return out;
}

export function formatCrashDiagnosticReport(opts: {
  errorMessage: string;
  errorStack?: string | null;
  componentStack?: string | null;
  ota?: CrashOtaIdentity | null;
}): string {
  const ota = opts.ota;
  return [
    "=== Stadium Edge Crash Diagnostics ===",
    `updateId: ${ota?.updateId ?? "—"}`,
    `runtimeVersion: ${ota?.runtimeVersion ?? "—"}`,
    `channel: ${ota?.channel ?? "—"}`,
    `isEmbeddedLaunch: ${ota ? String(ota.isEmbeddedLaunch) : "—"}`,
    `bundleSource: ${ota?.bundleSource ?? "—"}`,
    `isEmergencyLaunch: ${ota ? String(ota.isEmergencyLaunch) : "—"}`,
    `updatePreviouslyFailed: ${ota ? String(ota.updatePreviouslyFailed) : "—"}`,
    `failedLaunchCount: ${ota != null ? String(ota.failedLaunchCount) : "—"}`,
    "",
    `error: ${sanitizeCrashText(opts.errorMessage, 400)}`,
    "",
    "--- stack ---",
    sanitizeCrashText(opts.errorStack, 1800),
    "",
    "--- component stack ---",
    sanitizeCrashText(opts.componentStack, 1200),
  ].join("\n");
}
