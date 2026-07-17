import Constants from "expo-constants";

type PublicExtra = {
  clerkPublishableKey?: string;
  publicDomain?: string;
};

function bakedExtra(): PublicExtra {
  return (Constants.expoConfig?.extra ?? {}) as PublicExtra;
}

/**
 * Clerk publishable key. Metro inlines EXPO_PUBLIC_* at bundle time; EAS native
 * builds also bake values into expo.extra via app.config.js. Use `||` so an empty
 * inlined env string still falls back to the native build config.
 */
export function clerkPublishableKey(): string {
  const fromEnv = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "";
  return fromEnv || bakedExtra().clerkPublishableKey || "";
}

/** Published API host (no scheme). */
export function publicDomain(): string {
  const fromEnv = process.env.EXPO_PUBLIC_DOMAIN ?? "";
  return fromEnv || bakedExtra().publicDomain || "";
}
