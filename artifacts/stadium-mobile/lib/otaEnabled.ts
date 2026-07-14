import Constants from "expo-constants";

/**
 * OTA is opt-in only — baked at build time via EXPO_PUBLIC_OTA_ENABLED=true.
 * Default off for Expo Go, Metro dev server, and EAS development/preview builds
 * until the app is verified without any update machinery.
 */
export function isOtaClientEnabled(): boolean {
  if (process.env.EXPO_PUBLIC_OTA_ENABLED !== "true") return false;
  if (__DEV__) return false;
  if (Constants.executionEnvironment === "storeClient") return false;
  return true;
}

/** Cache partition key — never calls expo-updates APIs when OTA is disabled. */
export function getBundleCacheKey(): string {
  if (!isOtaClientEnabled()) {
    return __DEV__ ? "dev" : "embedded";
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Updates = require("expo-updates") as typeof import("expo-updates");
  if (!Updates.isEnabled) return "embedded";
  return Updates.updateId ?? Updates.runtimeVersion ?? "embedded";
}
