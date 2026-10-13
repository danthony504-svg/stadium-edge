/**
 * Dynamic Expo config — Associated Domains always match the Clerk publishable
 * key baked into the build (prevents pk_live client + pk_test webcredentials).
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
  const pk =
    process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ||
    process.env.CLERK_PUBLISHABLE_KEY ||
    "";
  const host = clerkFrontendApiHost(pk);
  if (host) {
    expo.ios = {
      ...expo.ios,
      associatedDomains: [`applinks:${host}`, `webcredentials:${host}`],
    };
  }
  return { expo };
};
