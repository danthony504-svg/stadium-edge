import type { ExpoConfig } from "expo/config";

import appJson from "./app.json";

const OTA_ENABLED = process.env.EXPO_PUBLIC_OTA_ENABLED === "true";
const OTA_CHANNEL = process.env.EXPO_PUBLIC_OTA_CHANNEL || "production";
const UPDATE_URL =
  (appJson.expo as ExpoConfig).updates?.url ??
  "https://u.expo.dev/9af36ab9-f953-4879-9dd2-82807ef7430c";

const expo = appJson.expo as ExpoConfig;

/** Native + JS OTA are disabled unless EXPO_PUBLIC_OTA_ENABLED=true at build time. */
export default (): ExpoConfig => ({
  ...expo,
  updates: OTA_ENABLED
    ? {
        url: UPDATE_URL,
        enabled: true,
        checkAutomatically: "ON_LOAD",
        fallbackToCacheTimeout: expo.updates?.fallbackToCacheTimeout ?? 0,
        requestHeaders: {
          "expo-channel-name": OTA_CHANNEL,
        },
      }
    : {
        enabled: false,
        checkAutomatically: "NEVER",
        fallbackToCacheTimeout: 0,
      },
});
