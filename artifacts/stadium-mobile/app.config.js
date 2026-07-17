const appJson = require("./app.json");

const OTA_ENABLED = process.env.EXPO_PUBLIC_OTA_ENABLED === "true";
const OTA_CHANNEL = process.env.EXPO_PUBLIC_OTA_CHANNEL || "production";
const UPDATE_URL =
  appJson.expo.updates?.url ??
  "https://u.expo.dev/9af36ab9-f953-4879-9dd2-82807ef7430c";

const expo = appJson.expo;

/** Native + JS OTA are disabled unless EXPO_PUBLIC_OTA_ENABLED=true at build time. */
module.exports = () => ({
  ...expo,
  extra: {
    ...expo.extra,
    /** Baked on EAS native builds; Metro may also inline EXPO_PUBLIC_* at bundle time. */
    clerkPublishableKey: process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY || "",
    publicDomain: process.env.EXPO_PUBLIC_DOMAIN || "",
  },
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
