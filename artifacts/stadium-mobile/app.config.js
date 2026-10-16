/**
 * Dynamic Expo config — Associated Domains always match the Clerk publishable
 * key baked into the build (prevents pk_live client + pk_test webcredentials).
 *
 * Ad Hoc preview profiles set EXPO_NO_CLERK_PASSKEYS=1. Those binaries must not
 * require the Associated Domains entitlement — Ad Hoc profiles without that
 * capability fail Xcode, and webcredentials are irrelevant without passkeys.
 */
const appJson = require("./app.json");

function clerkFrontendApiHost(publishableKey) {
  const m = String(publishableKey || "").match(/^pk_(?:test|live)_(.+)$/);
  if (!m?.[1]) return null;
  try {
    const decoded = Buffer.from(m[1], "base64").toString("utf8").replace(/\$$/, "").trim();
    return decoded.includes(".") ? decoded : null;
  } catch {
    return null;
  }
}

module.exports = () => {
  const expo = { ...appJson.expo };
  const stripPasskeys = String(process.env.EXPO_NO_CLERK_PASSKEYS ?? "") === "1";
  const pk =
    process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ||
    process.env.CLERK_PUBLISHABLE_KEY ||
    "";
  const host = clerkFrontendApiHost(pk);

  if (stripPasskeys) {
    // Must omit the key entirely — `associatedDomains: []` still makes Expo
    // prebuild emit com.apple.developer.associated-domains in entitlements,
    // which Ad Hoc profiles without that capability reject.
    const ios = { ...(expo.ios || {}) };
    delete ios.associatedDomains;
    expo.ios = ios;
  } else if (host) {
    expo.ios = {
      ...expo.ios,
      associatedDomains: [`applinks:${host}`, `webcredentials:${host}`],
    };
  }
  return { expo };
};
