/**
 * Pure crash-guards for /ota-debug rendering and snapshot shaping.
 * No expo-updates / React Native imports — safe for node:test.
 */

export const OTA_DEBUG_UNAVAILABLE = "not available";
export const OTA_DEBUG_UNKNOWN = "unknown";
export const OTA_DEBUG_NULL = "null";

/** Coerce any diagnostic field to a safe on-screen string. */
export function safeDiagText(value: unknown, fallback = OTA_DEBUG_UNAVAILABLE): string {
  if (value == null) return fallback;
  if (typeof value === "string") {
    const t = value.trim();
    return t.length ? t : fallback;
  }
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? value.toISOString() : fallback;
  }
  try {
    const s = String(value);
    return s && s !== "[object Object]" ? s : fallback;
  } catch {
    return fallback;
  }
}

/** Format Updates.createdAt / commitTime without throwing on Invalid Date. */
export function safeFormatCreatedAt(raw: unknown): string {
  if (raw == null || raw === "") return OTA_DEBUG_UNAVAILABLE;
  try {
    if (raw instanceof Date) {
      return Number.isFinite(raw.getTime()) ? raw.toISOString() : OTA_DEBUG_UNAVAILABLE;
    }
    const d = new Date(raw as string | number);
    return Number.isFinite(d.getTime()) ? d.toISOString() : safeDiagText(raw);
  } catch {
    return OTA_DEBUG_UNAVAILABLE;
  }
}

/**
 * Guarantee a string[] for LogBlock — never throw on null/undefined/non-iterable.
 * Reproduces the historic crash: `lines.map` when lines is undefined.
 */
export function safeLogLines(value: unknown, fallbackLine = "(none)"): string[] {
  if (value == null) return [fallbackLine];
  if (!Array.isArray(value)) {
    return [safeDiagText(value, fallbackLine)];
  }
  if (value.length === 0) return [fallbackLine];
  return value.map((line) => safeDiagText(line, fallbackLine));
}

/** Safe optional id display (manifest / persisted ready / update UUID). */
export function safeUpdateIdText(
  value: unknown,
  opts?: { embeddedFallback?: boolean; isEmbeddedLaunch?: boolean },
): string {
  const n = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!n || n === "—" || n === "-" || n === "null" || n === "undefined") {
    if (opts?.embeddedFallback && opts.isEmbeddedLaunch) return "embedded";
    return OTA_DEBUG_NULL;
  }
  if (n === "embedded" || n === "pending") return n;
  return String(value).trim();
}

export type OtaDebugRequiredFields = {
  updateId: string;
  isEmbeddedLaunch: string;
  createdAt: string;
  runtimeVersion: string;
  channel: string;
  checkAvailableUpdateId: string;
  downloadedUpdateId: string;
  persistedReadyId: string;
  isUpdatePending: string;
  recoveryPending: string;
  bannerExpression: string;
  otaIdentityFixVersion: string;
};

/**
 * Build the required on-screen field set from a partial/missing diagnostics
 * blob (cold deep-link, unhydrated context, AsyncStorage failure, etc.).
 */
export function buildSafeRequiredFields(input: {
  updateId?: unknown;
  isEmbeddedLaunch?: unknown;
  createdAt?: unknown;
  runtimeVersion?: unknown;
  channel?: unknown;
  checkAvailableUpdateId?: unknown;
  downloadedUpdateId?: unknown;
  persistedReadyId?: unknown;
  isUpdatePending?: unknown;
  recoveryPending?: unknown;
  bannerExpression?: unknown;
  otaIdentityFixVersion?: unknown;
  /** When true, context/provider has not hydrated yet. */
  contextHydrated?: boolean;
}): OtaDebugRequiredFields {
  const hydrated = input.contextHydrated !== false;
  const pendingHydration = hydrated ? "" : " (context not hydrated)";

  return {
    updateId: safeUpdateIdText(input.updateId) + pendingHydration,
    isEmbeddedLaunch:
      input.isEmbeddedLaunch == null
        ? OTA_DEBUG_UNKNOWN + pendingHydration
        : safeDiagText(!!input.isEmbeddedLaunch) + pendingHydration,
    createdAt: safeFormatCreatedAt(input.createdAt),
    runtimeVersion: safeDiagText(input.runtimeVersion, OTA_DEBUG_UNKNOWN),
    channel: safeDiagText(input.channel, OTA_DEBUG_UNKNOWN),
    checkAvailableUpdateId: safeUpdateIdText(input.checkAvailableUpdateId),
    downloadedUpdateId: safeUpdateIdText(input.downloadedUpdateId),
    persistedReadyId: safeUpdateIdText(input.persistedReadyId),
    isUpdatePending:
      input.isUpdatePending == null
        ? OTA_DEBUG_UNKNOWN + pendingHydration
        : safeDiagText(!!input.isUpdatePending),
    recoveryPending:
      input.recoveryPending == null
        ? OTA_DEBUG_UNKNOWN
        : safeDiagText(!!input.recoveryPending),
    bannerExpression: safeDiagText(input.bannerExpression, OTA_DEBUG_UNAVAILABLE),
    otaIdentityFixVersion: safeDiagText(input.otaIdentityFixVersion, OTA_DEBUG_UNAVAILABLE),
  };
}

/** Spread helper that never throws on null/undefined iterables (buildReport). */
export function safeSpreadLines(value: unknown): string[] {
  return safeLogLines(value, "");
}
