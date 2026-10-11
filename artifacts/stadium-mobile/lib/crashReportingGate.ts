/**
 * Gate for whether reportCrash may POST to the reliability ingest API.
 *
 * Production iOS/Android (Hermes / React Native) stays enabled.
 * Node unit tests, CI, cloud agents, and local node:test runs stay disabled
 * even when EXPO_PUBLIC_DOMAIN points at production.
 */

export type CrashReportingRuntimeHints = {
  /** Override RN detection (tests). */
  isReactNative?: boolean;
  /** Override Hermes detection (tests). */
  hasHermes?: boolean;
};

function envFlagTrue(v: string | undefined): boolean {
  const t = (v ?? "").trim().toLowerCase();
  return t === "1" || t === "true" || t === "yes" || t === "on";
}

function envFlagFalse(v: string | undefined): boolean {
  const t = (v ?? "").trim().toLowerCase();
  return t === "0" || t === "false" || t === "no" || t === "off";
}

/** Em-dash / empty / unknown placeholders used by the crash envelope. */
export function isBlankCrashMeta(value: string | null | undefined): boolean {
  if (value == null) return true;
  const t = String(value).trim();
  return t === "" || t === "—" || t === "-" || t === "unknown" || t === "…";
}

export function hasRealOtaIdentity(ota: {
  updateId?: string | null;
  runtimeVersion?: string | null;
  channel?: string | null;
} | null | undefined): boolean {
  if (!ota) return false;
  return (
    !isBlankCrashMeta(ota.updateId) ||
    !isBlankCrashMeta(ota.runtimeVersion) ||
    !isBlankCrashMeta(ota.channel)
  );
}

/**
 * Detect a real mobile JS runtime. Node test runners / agents lack these signals.
 */
export function isLikelyReactNativeRuntime(
  hints: CrashReportingRuntimeHints = {},
): boolean {
  if (typeof hints.isReactNative === "boolean") return hints.isReactNative;
  if (typeof hints.hasHermes === "boolean" && hints.hasHermes) return true;
  try {
    const g = globalThis as typeof globalThis & {
      HermesInternal?: unknown;
      navigator?: { product?: string };
    };
    if (g.HermesInternal) return true;
    const product = g.navigator?.product;
    if (product === "ReactNative") return true;
  } catch {
    // ignore
  }
  return false;
}

/**
 * Returns true when reportCrash may open a network POST.
 * Explicit EXPO_PUBLIC_CRASH_REPORTING=0 always wins (prod kill switch).
 * Explicit =1 allows network only for intentional integration harnesses.
 */
export function shouldSendCrashReports(
  env: NodeJS.ProcessEnv = process.env,
  hints: CrashReportingRuntimeHints = {},
): boolean {
  // Kill switches always win.
  if (envFlagFalse(env.EXPO_PUBLIC_CRASH_REPORTING)) return false;
  if (envFlagTrue(env.CRASH_REPORTING_DISABLED)) return false;

  // Explicit opt-in for rare harnesses that mock fetch themselves (after kill switches).
  if (envFlagTrue(env.EXPO_PUBLIC_CRASH_REPORTING)) return true;

  if ((env.NODE_ENV ?? "").toLowerCase() === "test") return false;
  if (env.NODE_TEST_CONTEXT || env.VITEST || env.JEST_WORKER_ID) return false;

  // CI / GitHub Actions Node jobs must never hit production ingest.
  if (envFlagTrue(env.CI) || envFlagTrue(env.GITHUB_ACTIONS)) {
    if (!isLikelyReactNativeRuntime(hints)) return false;
  }

  // Default: only real RN/Hermes runtimes POST. Blocks cloud agents + local node:test
  // even when EXPO_PUBLIC_DOMAIN=stadium-edge.onrender.com.
  return isLikelyReactNativeRuntime(hints);
}
