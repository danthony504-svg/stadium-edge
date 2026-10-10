/**
 * Build-time flag for the dedicated 1.0.3 force-update OTA bundle.
 * When true, the publish script swaps `app/` → `app.forceUpdate/` so Metro
 * never evaluates Clerk / StoreKit / Coach routes.
 */
export function isForceUpdateOnlyBuild(): boolean {
  return (process.env.EXPO_PUBLIC_FORCE_UPDATE_ONLY ?? "").trim().toLowerCase() === "true";
}

export const FORCE_UPDATE_APP_STORE_URL = "https://apps.apple.com/app/id6776024127";
