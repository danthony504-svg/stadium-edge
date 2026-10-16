/**
 * Ad Hoc preview profiles (preview-voice / preview-build78) set
 * EXPO_NO_CLERK_PASSKEYS=1 so the native binary omits ClerkExpoPasskeys —
 * matching the Ad Hoc Associated Domains entitlement constraint.
 * Other profiles leave passkeys linked.
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
