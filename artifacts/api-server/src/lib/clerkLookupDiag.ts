/**
 * Temporary sanitized Clerk Backend lookup classification.
 * Never logs userId, email, tokens, Authorization, or secret values.
 */

export type ClerkKeyMode = "test" | "live" | "missing" | "unknown";

/** sk_test_ / sk_live_ prefix only — never the secret body. */
export function clerkSecretKeyMode(
  env: NodeJS.ProcessEnv = process.env,
): ClerkKeyMode {
  const sk = env.CLERK_SECRET_KEY ?? "";
  if (!sk) return "missing";
  if (sk.startsWith("sk_test_")) return "test";
  if (sk.startsWith("sk_live_")) return "live";
  return "unknown";
}

/** pk_test_ / pk_live_ prefix only. */
export function clerkPublishableKeyMode(
  env: NodeJS.ProcessEnv = process.env,
): ClerkKeyMode {
  const pk = env.CLERK_PUBLISHABLE_KEY ?? "";
  if (!pk) return "missing";
  if (pk.startsWith("pk_test_")) return "test";
  if (pk.startsWith("pk_live_")) return "live";
  return "unknown";
}

export function clerkJwtKeyConfigured(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return typeof env.CLERK_JWT_KEY === "string" && env.CLERK_JWT_KEY.length > 0;
}

/**
 * Buckets for clerkClient.users.getUser failures (sanitized).
 * - unauthorized: HTTP 401 / invalid secret
 * - forbidden: HTTP 403
 * - not_found: HTTP 404
 * - rate_limited: HTTP 429
 * - network: fetch / offline / connection
 * - config: missing secret / SDK config
 * - other: everything else (includes status when known)
 */
export type ClerkLookupFailureCategory =
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "rate_limited"
  | "network"
  | "config"
  | "other"
  | "none";

export type ClerkLookupFailureDiag = {
  clerkHttpStatus: number | null;
  clerkErrorCode: string | null;
  clerkFailureCategory: ClerkLookupFailureCategory;
};

function readStatus(err: unknown): number | null {
  if (!err || typeof err !== "object") return null;
  const e = err as { status?: unknown; statusCode?: unknown };
  if (typeof e.status === "number" && Number.isFinite(e.status)) return e.status;
  if (typeof e.statusCode === "number" && Number.isFinite(e.statusCode)) {
    return e.statusCode;
  }
  return null;
}

function readClerkCode(err: unknown): string | null {
  if (!err || typeof err !== "object") return null;
  const e = err as {
    code?: unknown;
    errors?: unknown;
    name?: unknown;
  };
  if (typeof e.code === "string" && e.code.length > 0 && e.code.length < 80) {
    return e.code;
  }
  if (Array.isArray(e.errors) && e.errors[0] && typeof e.errors[0] === "object") {
    const first = e.errors[0] as { code?: unknown };
    if (typeof first.code === "string" && first.code.length > 0 && first.code.length < 80) {
      return first.code;
    }
  }
  if (typeof e.name === "string" && e.name.length > 0 && e.name.length < 80) {
    return e.name;
  }
  return null;
}

function looksLikeNetwork(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { message?: unknown; name?: unknown; code?: unknown };
  const msg = typeof e.message === "string" ? e.message.toLowerCase() : "";
  const name = typeof e.name === "string" ? e.name.toLowerCase() : "";
  const code = typeof e.code === "string" ? e.code.toLowerCase() : "";
  return (
    name.includes("fetch") ||
    name.includes("network") ||
    name.includes("offline") ||
    code === "econnreset" ||
    code === "enotfound" ||
    code === "etimedout" ||
    code === "econnrefused" ||
    msg.includes("network") ||
    msg.includes("fetch failed") ||
    msg.includes("socket")
  );
}

export function classifyClerkLookupError(err: unknown): ClerkLookupFailureDiag {
  const clerkHttpStatus = readStatus(err);
  const clerkErrorCode = readClerkCode(err);

  if (clerkHttpStatus === 401) {
    return { clerkHttpStatus, clerkErrorCode, clerkFailureCategory: "unauthorized" };
  }
  if (clerkHttpStatus === 403) {
    return { clerkHttpStatus, clerkErrorCode, clerkFailureCategory: "forbidden" };
  }
  if (clerkHttpStatus === 404) {
    return { clerkHttpStatus, clerkErrorCode, clerkFailureCategory: "not_found" };
  }
  if (clerkHttpStatus === 429) {
    return { clerkHttpStatus, clerkErrorCode, clerkFailureCategory: "rate_limited" };
  }
  if (looksLikeNetwork(err)) {
    return { clerkHttpStatus, clerkErrorCode, clerkFailureCategory: "network" };
  }

  const code = (clerkErrorCode ?? "").toLowerCase();
  if (
    code.includes("secret") ||
    code.includes("invalid_clerk_secret") ||
    code === "authentication_invalid"
  ) {
    return {
      clerkHttpStatus,
      clerkErrorCode,
      clerkFailureCategory: clerkHttpStatus === 401 ? "unauthorized" : "config",
    };
  }

  return { clerkHttpStatus, clerkErrorCode, clerkFailureCategory: "other" };
}
