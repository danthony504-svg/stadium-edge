import type { ExpoConfig } from "expo/config";

import appJson from "./app.json";

const OTA_ENABLED = process.env.EXPO_PUBLIC_OTA_ENABLED === "true";

const expo = appJson.expo as ExpoConfig;

/** Native + JS OTA are disabled unless EXPO_PUBLIC_OTA_ENABLED=true at build time. */
export default (): ExpoConfig => ({
  ...expo,
  updates: {
    ...expo.updates,
    enabled: OTA_ENABLED,
    checkAutomatically: OTA_ENABLED ? "ON_LOAD" : "NEVER",
    ...(OTA_ENABLED
      ? {}
      : {
          url: undefined,
          requestHeaders: undefined,
        }),
  },
});
