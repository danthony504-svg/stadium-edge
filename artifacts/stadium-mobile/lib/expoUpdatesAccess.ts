/**
 * Lazy, fail-soft access to expo-updates.
 *
 * Static `import "expo-updates"` evaluates requireNativeModule + JSON.parse
 * of the native manifest at module load. That throw cannot be caught by a
 * React error boundary and is exactly how /ota-debug deep-links crash when
 * the native module or context is not ready yet (DeferredOtaRuntime has not
 * hydrated, or a prior updater init already failed the module evaluation).
 */

export type ExpoUpdatesModule = typeof import("expo-updates");

export type ExpoUpdatesLatestContext = ExpoUpdatesModule extends {
  latestContext: infer C;
}
  ? C
  : unknown;

let cached: ExpoUpdatesModule | null | undefined;

/** Reset between unit tests. */
export function resetExpoUpdatesAccessForTests(): void {
  cached = undefined;
}

/**
 * Inject a fake expo-updates module for Node tests (call-count proofs).
 * Pass `undefined` to clear and restore lazy require behavior.
 */
export function setExpoUpdatesModuleForTests(
  mod: ExpoUpdatesModule | null | undefined,
): void {
  cached = mod;
}

/**
 * Load expo-updates once. Returns null when native module / manifest parse
 * throws — callers must render fallbacks, never rethrow.
 */
export function tryGetExpoUpdates(): ExpoUpdatesModule | null {
  if (cached !== undefined) return cached;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cached = require("expo-updates") as ExpoUpdatesModule;
    return cached;
  } catch {
    cached = null;
    return null;
  }
}

/** latestContext may be missing before UpdatesEmitter hydrates. */
export function tryGetLatestContext(): ExpoUpdatesLatestContext | null {
  const Updates = tryGetExpoUpdates();
  if (!Updates) return null;
  try {
    const ctx = (Updates as { latestContext?: ExpoUpdatesLatestContext | null }).latestContext;
    return ctx ?? null;
  } catch {
    return null;
  }
}

export function expoUpdatesLoadError(): string | null {
  if (tryGetExpoUpdates()) return null;
  return "expo-updates native module unavailable or failed to initialize";
}
