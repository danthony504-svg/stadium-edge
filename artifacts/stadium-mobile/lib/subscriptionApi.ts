/**
 * Client → api-server subscription entitlement sync.
 * Best-effort: failures never block local StoreKit unlock.
 */

import { fetch as expoFetch } from "expo/fetch";

import { API_BASE } from "./apiBase";
import { appVersionRequestHeaders } from "./appVersionGate";
import { getAuthTokenGetter } from "./authToken";
import type { PlanId } from "./entitlements";
import type { StoreKitCustomerSnapshot } from "./purchases";

export type ServerSubscriptionEntitlement = {
  planId: PlanId | null;
  productId: string | null;
  status: string;
  expiresAt: string | null;
  managementUrl: string | null;
  source: string;
  storeKitActive?: boolean;
};

export type ServerAccessFlags = {
  /** RevenueCat / DB paid entitlement when present. */
  entitlement: ServerSubscriptionEntitlement | null;
  /**
   * Server-verified designated App Review account (Clerk userId → APP_REVIEW_EMAIL).
   * Never trust a client email claim for this flag.
   */
  appReviewAccess: boolean;
  /**
   * Server-verified owner/test account (Clerk userId → OWNER_TEST_EMAILS / ADMIN_EMAILS).
   * Never trust EXPO_PUBLIC_ADMIN_EMAILS for this flag.
   */
  ownerAccess: boolean;
};

type SubFetchResult = {
  response: Response | null;
  tokenPresent: boolean;
  requestStarted: boolean;
};

async function subFetch(
  path: string,
  init?: { method?: string; body?: string },
): Promise<Response | null> {
  const result = await subFetchDetailed(path, init);
  return result.response;
}

/** Internal fetch with sanitized timing/token presence (no token values). */
async function subFetchDetailed(
  path: string,
  init?: { method?: string; body?: string },
): Promise<SubFetchResult> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...appVersionRequestHeaders(),
  };
  let tokenPresent = false;
  let requestStarted = false;
  try {
    const getter = getAuthTokenGetter();
    const token = getter ? await getter() : null;
    tokenPresent = typeof token === "string" && token.length > 0;
    if (!tokenPresent) {
      return { response: null, tokenPresent: false, requestStarted: false };
    }
    headers.Authorization = `Bearer ${token}`;
  } catch {
    return { response: null, tokenPresent: false, requestStarted: false };
  }
  try {
    requestStarted = true;
    const response = (await expoFetch(`${API_BASE}${path}`, {
      method: init?.method ?? "GET",
      headers,
      body: init?.body,
    })) as unknown as Response;
    return { response, tokenPresent, requestStarted };
  } catch {
    return { response: null, tokenPresent, requestStarted };
  }
}

/** Push local StoreKit snapshot to the server after purchase / restore. */
export async function syncSubscriptionToServer(
  snapshot: StoreKitCustomerSnapshot,
): Promise<boolean> {
  const res = await subFetch("/subscriptions/sync", {
    method: "POST",
    body: JSON.stringify({
      planId: snapshot.planId,
      productIds: snapshot.activeProductIds,
      entitlementIds: snapshot.activeEntitlementIds,
      originalAppUserId: snapshot.originalAppUserId,
      managementUrl: snapshot.managementUrl,
    }),
  });
  return res != null && res.ok;
}

/**
 * Ask the server to verify this Clerk user against RevenueCat REST (secret key)
 * and persist a trusted entitlement for Coach Q&A. Never grants from local claims.
 */
export async function verifyRestoredSubscriptionOnServer(): Promise<{
  ok: boolean;
  storeKitActive: boolean;
  planId: PlanId | null;
}> {
  const res = await subFetch("/subscriptions/restore-verify", {
    method: "POST",
    body: JSON.stringify({}),
  });
  if (!res) return { ok: false, storeKitActive: false, planId: null };
  try {
    const json = (await res.json()) as {
      ok?: boolean;
      storeKitActive?: boolean;
      planId?: PlanId | "free" | null;
    };
    const planId =
      json.planId === "go" || json.planId === "pro" ? json.planId : null;
    return {
      ok: res.ok && json.ok !== false,
      storeKitActive: !!json.storeKitActive && !!planId,
      planId,
    };
  } catch {
    return { ok: false, storeKitActive: false, planId: null };
  }
}

export async function fetchServerSubscription(): Promise<ServerSubscriptionEntitlement | null> {
  const flags = await fetchServerAccessFlags();
  return flags?.entitlement ?? null;
}

/** Temporary sanitized mobile entitlement probe (booleans only). */
export type EntitlementFetchDiag = {
  tokenPresent: boolean;
  requestStarted: boolean;
  responseStatus: number | null;
  responseOk: boolean;
  flagsReceived: boolean;
  ownerAccessReceived: boolean;
  /** True when getToken was missing and fetch aborted (no retry in this call). */
  abortedBeforeRequestNoToken: boolean;
};

function logEntitlementFetchDiag(diag: EntitlementFetchDiag): void {
  try {
    console.info("[entitlement-diag]", JSON.stringify(diag));
  } catch {
    // ignore
  }
}

/**
 * Authenticated access flags from api-server. Fail closed (null) when unsigned
 * or the request fails — callers must not invent appReviewAccess locally.
 */
export async function fetchServerAccessFlags(): Promise<ServerAccessFlags | null> {
  const { response: res, tokenPresent, requestStarted } = await subFetchDetailed(
    "/subscriptions/entitlement",
  );
  const abortedBeforeRequestNoToken = !tokenPresent && !requestStarted;
  if (!res) {
    logEntitlementFetchDiag({
      tokenPresent,
      requestStarted,
      responseStatus: null,
      responseOk: false,
      flagsReceived: false,
      ownerAccessReceived: false,
      abortedBeforeRequestNoToken,
    });
    return null;
  }
  const responseStatus = typeof res.status === "number" ? res.status : null;
  const responseOk = !!res.ok;
  if (!res.ok) {
    logEntitlementFetchDiag({
      tokenPresent,
      requestStarted,
      responseStatus,
      responseOk: false,
      flagsReceived: false,
      ownerAccessReceived: false,
      abortedBeforeRequestNoToken: false,
    });
    return null;
  }
  try {
    const json = (await res.json()) as {
      ok?: boolean;
      entitlement?: ServerSubscriptionEntitlement | null;
      appReviewAccess?: boolean;
      ownerAccess?: boolean;
    };
    const ownerAccessReceived = json.ownerAccess === true;
    logEntitlementFetchDiag({
      tokenPresent,
      requestStarted,
      responseStatus,
      responseOk: true,
      flagsReceived: true,
      ownerAccessReceived,
      abortedBeforeRequestNoToken: false,
    });
    return {
      entitlement: json.entitlement ?? null,
      // Only server booleans grant privileged access — ignore client claims.
      appReviewAccess: json.appReviewAccess === true,
      ownerAccess: ownerAccessReceived,
    };
  } catch {
    logEntitlementFetchDiag({
      tokenPresent,
      requestStarted,
      responseStatus,
      responseOk: true,
      flagsReceived: false,
      ownerAccessReceived: false,
      abortedBeforeRequestNoToken: false,
    });
    return null;
  }
}
