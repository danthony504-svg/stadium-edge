/**
 * Profile `preview-build78` sets EXPO_NO_CLERK_PASSKEYS=1 so the native binary
 * matches Build 78 (no ClerkExpoPasskeys). Other profiles leave passkeys linked.
 */
const strip = String(process.env.EXPO_NO_CLERK_PASSKEYS ?? "") === "1";

module.exports = {
  dependencies: strip
    ? {
        "@clerk/expo-passkeys": {
          platforms: {
            ios: null,
            android: null,
          },
        },
      }
    : {},
};
