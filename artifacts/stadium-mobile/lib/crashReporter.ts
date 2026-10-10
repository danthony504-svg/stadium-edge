/**
 * Phase A pure-JS crash reporter (OTA-safe, runtime 1.1.0).
 * Non-blocking, short timeout, no infinite retries, no backend secrets in the app.
 */

import {
  sanitizeCrashText,
  type CrashOtaIdentity,
} from "./crashDiagnostics.ts";

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

function shouldSkipClientDedupe(fp: string, now = Date.now()): boolean {
  const last = recentFingerprints.get(fp);
  if (last != null && now - last < CLIENT_DEDUPE_MS) return true;
  recentFingerprints.set(fp, now);
  // Bound map size.
  if (recentFingerprints.size > 40) {
    const cutoff = now - CLIENT_DEDUPE_MS;
    for (const [k, t] of recentFingerprints) {
      if (t < cutoff) recentFingerprints.delete(k);
    }
  }
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
 */
export function reportCrash(input: CrashReportInput): void {
  try {
    const fp = clientFingerprint(
      String(input.errorMessage ?? ""),
      String(input.errorStack ?? ""),
    );
    if (shouldSkipClientDedupe(fp)) return;
    if (inFlight >= MAX_IN_FLIGHT) return;
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
