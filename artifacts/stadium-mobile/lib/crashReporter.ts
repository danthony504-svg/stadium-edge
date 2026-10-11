/**
 * Phase A pure-JS crash reporter (OTA-safe, runtime 1.1.0).
 * Non-blocking, short timeout, no infinite retries, no backend secrets in the app.
 *
 * Network POSTs are gated: React Native / Hermes production stays on;
 * Node tests, CI, and cloud agents never reach production ingest.
 */

import {
  sanitizeCrashText,
  type CrashOtaIdentity,
} from "./crashDiagnostics.ts";
import {
  hasRealOtaIdentity,
  shouldSendCrashReports,
} from "./crashReportingGate.ts";

/** Same rule as apiBase.ts — inlined so node:test needs no extension rewrite. */
const DOMAIN = process.env.EXPO_PUBLIC_DOMAIN;
const API_BASE = DOMAIN ? `https://${DOMAIN}/api` : "/api";

const REPORT_TIMEOUT_MS = 4_000;
/** Client-side quiet window for identical fingerprints (no retry storm). */
const CLIENT_DEDUPE_MS = 60_000;
const MAX_IN_FLIGHT = 1;

export type CrashReportInput = {
  errorMessage: string;
  errorStack?: string | null;
  componentStack?: string | null;
  ota?: CrashOtaIdentity | null;
  appVersion?: string | null;
  /** Defaults to ios (production OTA surface). Avoids a react-native import in unit tests. */
  platform?: "ios" | "android" | "unknown";
};

type CrashEnvelope = {
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
  clientTs: number;
  isEmbeddedLaunch: boolean;
  isEmergencyLaunch: boolean;
  failedLaunchCount: number;
};

let sessionId: string | null = null;
let inFlight = 0;
const recentFingerprints = new Map<string, number>();
/** One metadata-enrichment POST allowed per fingerprint within the quiet window. */
const recentEnrichments = new Map<string, number>();
/** Errors already reported by ErrorBoundary — global handler skips these. */
const boundaryReported = new Map<string, number>();
const BOUNDARY_MARK_MS = 15_000;

export function getAnonymousSessionId(): string {
  if (sessionId) return sessionId;
  sessionId = `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  return sessionId;
}

/** Test helper — reset module state. */
export function _resetCrashReporterForTests(): void {
  sessionId = null;
  inFlight = 0;
  recentFingerprints.clear();
  recentEnrichments.clear();
  boundaryReported.clear();
}

function clientFingerprint(message: string, stack: string): string {
  const head = (stack || "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 3)
    .join("|");
  return `${message}|${head}`.slice(0, 240);
}

/** Mark a crash as already reported by ErrorBoundary (prevents global double-post). */
export function markBoundaryReported(
  message: string,
  stack?: string | null,
  now = Date.now(),
): void {
  const fp = clientFingerprint(String(message ?? ""), String(stack ?? ""));
  boundaryReported.set(fp, now);
  if (boundaryReported.size > 40) {
    const cutoff = now - BOUNDARY_MARK_MS;
    for (const [k, t] of boundaryReported) {
      if (t < cutoff) boundaryReported.delete(k);
    }
  }
}

export function wasBoundaryReported(
  message: string,
  stack?: string | null,
  now = Date.now(),
): boolean {
  const fp = clientFingerprint(String(message ?? ""), String(stack ?? ""));
  const last = boundaryReported.get(fp);
  return last != null && now - last < BOUNDARY_MARK_MS;
}

function pruneMap(map: Map<string, number>, now: number, windowMs: number): void {
  if (map.size <= 40) return;
  const cutoff = now - windowMs;
  for (const [k, t] of map) {
    if (t < cutoff) map.delete(k);
  }
}

/**
 * Skip duplicate posts. Metadata enrichment (ErrorFallback with real OTA) may
 * bypass once so blank update/runtime/channel/app can be filled server-side.
 */
function shouldSkipClientDedupe(
  fp: string,
  isEnrichment: boolean,
  now = Date.now(),
): boolean {
  if (isEnrichment) {
    const last = recentEnrichments.get(fp);
    if (last != null && now - last < CLIENT_DEDUPE_MS) return true;
    recentEnrichments.set(fp, now);
    pruneMap(recentEnrichments, now, CLIENT_DEDUPE_MS);
    return false;
  }
  const last = recentFingerprints.get(fp);
  if (last != null && now - last < CLIENT_DEDUPE_MS) return true;
  recentFingerprints.set(fp, now);
  pruneMap(recentFingerprints, now, CLIENT_DEDUPE_MS);
  return false;
}

export function buildCrashEnvelope(input: CrashReportInput): CrashEnvelope {
  const ota = input.ota;
  return {
    errorMessage: sanitizeCrashText(input.errorMessage, 400),
    errorStack: sanitizeCrashText(input.errorStack, 1800),
    componentStack: sanitizeCrashText(input.componentStack, 1200),
    updateId: sanitizeCrashText(ota?.updateId ?? "—", 120),
    runtimeVersion: sanitizeCrashText(ota?.runtimeVersion ?? "—", 40),
    channel: sanitizeCrashText(ota?.channel ?? "—", 40),
    appVersion: sanitizeCrashText(input.appVersion ?? "—", 40),
    bundleSource: sanitizeCrashText(ota?.bundleSource ?? "unknown", 40),
    platform: input.platform ?? "ios",
    sessionId: getAnonymousSessionId(),
    clientTs: Date.now(),
    isEmbeddedLaunch: !!ota?.isEmbeddedLaunch,
    isEmergencyLaunch: !!ota?.isEmergencyLaunch,
    failedLaunchCount:
      typeof ota?.failedLaunchCount === "number" ? ota.failedLaunchCount : 0,
  };
}

async function resolveAppVersion(): Promise<string> {
  try {
    const Constants = (await import("expo-constants")).default;
    const v =
      Constants?.expoConfig?.version ||
      Constants?.nativeApplicationVersion ||
      "";
    return typeof v === "string" && v.trim() ? v.trim() : "—";
  } catch {
    return "—";
  }
}

async function resolveOtaIdentity(): Promise<CrashOtaIdentity | null> {
  try {
    const Updates = await import("expo-updates");
    let channelHeader: string | undefined;
    try {
      const Constants = (await import("expo-constants")).default;
      const hdr = Constants?.expoConfig?.updates?.requestHeaders?.["expo-channel-name"];
      if (typeof hdr === "string" && hdr.trim()) channelHeader = hdr.trim();
    } catch {
      // optional
    }
    const isEmbeddedLaunch = !!Updates.isEmbeddedLaunch;
    return {
      updateId: Updates.updateId
        ? String(Updates.updateId)
        : isEmbeddedLaunch
          ? "embedded"
          : "—",
      runtimeVersion: Updates.runtimeVersion ? String(Updates.runtimeVersion) : "—",
      channel: (Updates.channel && String(Updates.channel)) || channelHeader || "—",
      bundleSource: !Updates.isEnabled
        ? "unknown"
        : isEmbeddedLaunch
          ? "embedded"
          : "ota",
      isEmbeddedLaunch,
      isEmergencyLaunch: !!Updates.isEmergencyLaunch,
      updatePreviouslyFailed: false,
      failedLaunchCount: 0,
    };
  } catch {
    return null;
  }
}

/**
 * Fire-and-forget crash report. Never throws. At most one in-flight POST.
 * No retries — server dedupes; client quiet-window prevents loops.
 * Never recursively throws into ErrorBoundary.
 */
export function reportCrash(input: CrashReportInput): void {
  try {
    if (!shouldSendCrashReports()) return;

    const fp = clientFingerprint(
      String(input.errorMessage ?? ""),
      String(input.errorStack ?? ""),
    );
    const isEnrichment = hasRealOtaIdentity(input.ota);
    if (shouldSkipClientDedupe(fp, isEnrichment)) return;
    // Allow one enrichment alongside an in-flight initial report so ErrorFallback
    // can fill blank OTA fields; still cap concurrent POSTs.
    if (!isEnrichment && inFlight >= MAX_IN_FLIGHT) return;
    if (isEnrichment && inFlight >= MAX_IN_FLIGHT + 1) return;
    inFlight += 1;
    void (async () => {
      try {
        const ota = input.ota ?? (await resolveOtaIdentity());
        const appVersion = input.appVersion ?? (await resolveAppVersion());
        const body = buildCrashEnvelope({ ...input, ota, appVersion });
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), REPORT_TIMEOUT_MS);
        try {
          await fetch(`${API_BASE}/reliability/crashes`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            signal: ac.signal,
          });
        } finally {
          clearTimeout(timer);
        }
      } catch {
        // Fail soft — never retry.
      } finally {
        inFlight = Math.max(0, inFlight - 1);
      }
    })();
  } catch {
    // Fail soft.
  }
}
