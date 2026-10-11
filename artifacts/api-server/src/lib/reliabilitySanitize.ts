/**
 * Server-side re-sanitization for crash ingest.
 * Never persist emails, tokens, secrets, or oversized blobs.
 */

import { isKnownCrashTestFixture } from "./reliabilityCrashMeta.js";

const REDACT = "[redacted]";

const SECRET_PATTERNS: RegExp[] = [
  /\bBearer\s+[A-Za-z0-9._\-+=\/]+/gi,
  /\bAuthorization:\s*\S+/gi,
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
  /\b(sk|pk)_(live|test)_[A-Za-z0-9]+\b/g,
  /\bappl_v\d+_[A-Za-z0-9]+\b/gi,
  /\bgoog_[A-Za-z0-9]+\b/gi,
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
  /\b(password|passwd|secret|token|api[_-]?key|refresh[_-]?token|odds[_-]?api[_-]?key)\s*[:=]\s*\S+/gi,
  /\bstadium-edge:[^\s"']+/gi,
  /\buser_[A-Za-z0-9]{20,}\b/g,
  /\bsess_[A-Za-z0-9]{20,}\b/g,
  /\b[A-Za-z0-9+\/=]{80,}\b/g,
];

export const CRASH_MAX_BODY_BYTES = 8_192;
export const CRASH_MAX_MESSAGE = 400;
export const CRASH_MAX_STACK = 1_800;
export const CRASH_MAX_COMPONENT = 1_200;
export const CRASH_MAX_FIELD = 120;
/** Dedupe / Telegram quiet window for the same fingerprint. */
export const CRASH_DEDUPE_WINDOW_MS = 30 * 60 * 1000;
/** Row retention. */
export const CRASH_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;

export function sanitizeReliabilityText(
  input: string | null | undefined,
  maxLen: number,
): string {
  if (input == null) return "";
  let out = String(input);
  for (const re of SECRET_PATTERNS) {
    out = out.replace(re, REDACT);
  }
  out = out.replace(/\/var\/mobile\/Containers\/[^\s)]+/g, "[app-container]");
  out = out.replace(/file:\/\/[^\s)]+/g, "[file]");
  if (out.length > maxLen) out = `${out.slice(0, maxLen)}…`;
  return out;
}

export function crashFingerprint(message: string, stack: string): string {
  const head = (stack || "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 4)
    .join("|");
  const base = `${message}|${head}`.slice(0, 500);
  // FNV-1a 32-bit — stable, no crypto dependency for fingerprinting.
  let h = 0x811c9dc5;
  for (let i = 0; i < base.length; i++) {
    h ^= base.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `fp_${(h >>> 0).toString(16).padStart(8, "0")}`;
}

export type CrashIngestInput = {
  errorMessage?: unknown;
  errorStack?: unknown;
  componentStack?: unknown;
  updateId?: unknown;
  runtimeVersion?: unknown;
  channel?: unknown;
  appVersion?: unknown;
  bundleSource?: unknown;
  platform?: unknown;
  sessionId?: unknown;
  clientTs?: unknown;
  isEmbeddedLaunch?: unknown;
  isEmergencyLaunch?: unknown;
  failedLaunchCount?: unknown;
};

export type SanitizedCrashEvent = {
  fingerprint: string;
  severity: "critical";
  errorMessage: string;
  errorStack: string;
  componentStack: string;
  updateId: string;
  runtimeVersion: string;
  channel: string;
  appVersion: string;
  bundleSource: string;
  platform: string;
  sessionId: string;
  clientTs: Date | null;
  isEmbeddedLaunch: boolean | null;
  isEmergencyLaunch: boolean | null;
  failedLaunchCount: number | null;
};

function shortField(v: unknown, max = CRASH_MAX_FIELD): string {
  if (typeof v !== "string") return "";
  return sanitizeReliabilityText(v, max);
}

/**
 * Validate + sanitize a crash POST body. Returns null when unusable.
 * Never accepts nested objects / arrays (blocks full API payloads).
 */
export function parseAndSanitizeCrashBody(
  raw: unknown,
): SanitizedCrashEvent | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const body = raw as CrashIngestInput;
  // Reject surprise nested payloads that look like full API dumps.
  for (const [k, v] of Object.entries(body)) {
    if (v != null && typeof v === "object") return null;
    if (typeof k !== "string" || k.length > 64) return null;
  }
  const errorMessage = shortField(body.errorMessage, CRASH_MAX_MESSAGE).trim();
  if (!errorMessage) return null;
  const errorStack = shortField(body.errorStack, CRASH_MAX_STACK);
  const componentStack = shortField(body.componentStack, CRASH_MAX_COMPONENT);
  // Defense-in-depth: drop known unit-test fixture payloads if a harness leaks.
  if (isKnownCrashTestFixture(errorMessage, errorStack)) return null;
  const sessionId = shortField(body.sessionId, 64);
  if (!sessionId || !/^[A-Za-z0-9_-]{8,64}$/.test(sessionId)) return null;

  let clientTs: Date | null = null;
  if (typeof body.clientTs === "number" && Number.isFinite(body.clientTs)) {
    const d = new Date(body.clientTs);
    if (!Number.isNaN(d.getTime())) clientTs = d;
  } else if (typeof body.clientTs === "string" && body.clientTs.trim()) {
    const d = new Date(body.clientTs);
    if (!Number.isNaN(d.getTime())) clientTs = d;
  }

  const failedLaunchCount =
    typeof body.failedLaunchCount === "number" &&
    Number.isFinite(body.failedLaunchCount)
      ? Math.max(0, Math.min(100, Math.floor(body.failedLaunchCount)))
      : null;

  return {
    fingerprint: crashFingerprint(errorMessage, errorStack),
    severity: "critical",
    errorMessage,
    errorStack,
    componentStack,
    updateId: shortField(body.updateId) || "—",
    runtimeVersion: shortField(body.runtimeVersion) || "—",
    channel: shortField(body.channel) || "—",
    appVersion: shortField(body.appVersion) || "—",
    bundleSource: shortField(body.bundleSource) || "unknown",
    platform: shortField(body.platform) || "unknown",
    sessionId,
    clientTs,
    isEmbeddedLaunch:
      typeof body.isEmbeddedLaunch === "boolean" ? body.isEmbeddedLaunch : null,
    isEmergencyLaunch:
      typeof body.isEmergencyLaunch === "boolean"
        ? body.isEmergencyLaunch
        : null,
    failedLaunchCount,
  };
}
