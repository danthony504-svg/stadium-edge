/**
 * Client → api-server subscription entitlement sync.
 * Best-effort: failures never block local StoreKit unlock.
 */

import { fetch as expoFetch } from "expo/fetch";

import { API_BASE } from "./apiBase";
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
};

async function subFetch(
  path: string,
  init?: { method?: string; body?: string },
): Promise<Response | null> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  try {
    const getter = getAuthTokenGetter();
    const token = getter ? await getter() : null;
    if (!token) return null;
    headers.Authorization = `Bearer ${token}`;
  } catch {
    return null;
  }
  try {
    return (await expoFetch(`${API_BASE}${path}`, {
      method: init?.method ?? "GET",
      headers,
      body: init?.body,
    })) as unknown as Response;
  } catch {
    return null;
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

export async function fetchServerSubscription(): Promise<ServerSubscriptionEntitlement | null> {
  const res = await subFetch("/subscriptions/entitlement");
  if (!res || !res.ok) return null;
  try {
    const json = (await res.json()) as {
      ok?: boolean;
      entitlement?: ServerSubscriptionEntitlement | null;
    };
    return json.entitlement ?? null;
  } catch {
    return null;
  }
}
