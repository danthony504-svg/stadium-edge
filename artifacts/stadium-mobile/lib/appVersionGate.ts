/**
 * Client min-version gate — reads native marketing version + /app/config.
 * Never installs a native update via Expo OTA; only links to the App Store.
 */

import Constants from "expo-constants";
import { Platform } from "react-native";

import { API_BASE } from "./apiBase";
import {
  APP_STORE_IOS_URL,
  EMBEDDED_MIN_IOS_VERSION,
  decideForceUpdate,
  type ForceUpdateDecision,
} from "./appVersion";

export type AppConfigResponse = {
  ok?: boolean;
  minIosVersion?: string;
  appStoreUrl?: string;
  updateRequiredMessage?: string;
};

/** Native marketing version (e.g. 1.0.3 / 1.1.0). */
export function getNativeAppVersion(): string {
  try {
    const native = (Constants as { nativeAppVersion?: string | null }).nativeAppVersion;
    if (typeof native === "string" && native.trim()) return native.trim();
  } catch {
    /* ignore */
  }
  try {
    const fromExpo = Constants.expoConfig?.version;
    if (typeof fromExpo === "string" && fromExpo.trim()) return fromExpo.trim();
  } catch {
    /* ignore */
  }
  return "0.0.0";
}

export function appVersionRequestHeaders(): Record<string, string> {
  return {
    "X-App-Version": getNativeAppVersion(),
    "X-App-Platform": Platform.OS,
  };
}

/**
 * Dedicated 1.0.3 force-update OTA sets this so offline still blocks with the
 * embedded 1.1.0 floor. Normal 1.1.0 builds leave it unset (fail-open offline).
 */
export function preferEmbeddedFloorForForceUpdate(): boolean {
  return (process.env.EXPO_PUBLIC_FORCE_UPDATE_FLOOR ?? "").trim().toLowerCase() === "true";
}

export async function fetchAppConfig(signal?: AbortSignal): Promise<{
  reachable: boolean;
  config: AppConfigResponse | null;
}> {
  try {
    const res = await fetch(`${API_BASE}/app/config`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        ...appVersionRequestHeaders(),
      },
      signal,
    });
    if (!res.ok) return { reachable: false, config: null };
    const json = (await res.json()) as AppConfigResponse;
    return { reachable: true, config: json };
  } catch {
    return { reachable: false, config: null };
  }
}

export async function evaluateForceUpdate(signal?: AbortSignal): Promise<ForceUpdateDecision> {
  const currentVersion = getNativeAppVersion();
  // Web / non-iOS: never force App Store update from this gate.
  if (Platform.OS !== "ios") {
    return {
      required: false,
      currentVersion,
      minIosVersion: EMBEDDED_MIN_IOS_VERSION,
      appStoreUrl: APP_STORE_IOS_URL,
      message: "",
    };
  }
  const { reachable, config } = await fetchAppConfig(signal);
  return decideForceUpdate({
    currentVersion,
    serverMinIosVersion: config?.minIosVersion,
    serverAppStoreUrl: config?.appStoreUrl ?? APP_STORE_IOS_URL,
    serverMessage: config?.updateRequiredMessage,
    serverReachable: reachable,
    preferEmbeddedFloor: preferEmbeddedFloorForForceUpdate(),
  });
}
