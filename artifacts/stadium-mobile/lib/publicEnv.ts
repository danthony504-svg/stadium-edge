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

/** Whether Clerk auth env is present in Metro bundle or native extra (no key value). */
export function clerkAuthEnvLoaded(): boolean {
  const fromEnv = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "";
  if (fromEnv.length > 0) return true;
  const baked = bakedExtra().clerkPublishableKey ?? "";
  return baked.length > 0;
}

/** Short git commit baked into Metro bundle for dev diagnostics. */
export function metroCommitShort(): string {
  const commit = process.env.EXPO_PUBLIC_GIT_COMMIT ?? "not-baked";
  if (commit === "not-baked" || commit === "unknown") return commit;
  return commit.length > 10 ? `${commit.slice(0, 10)}…` : commit;
}

/** Published API host (no scheme). */
export function publicDomain(): string {
  const fromEnv = process.env.EXPO_PUBLIC_DOMAIN ?? "";
  return fromEnv || bakedExtra().publicDomain || "";
}
