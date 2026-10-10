/**
 * Server-side RevenueCat subscriber verification (secret API key only).
 * Used after Restore Purchases so Coach Q&A can unlock without waiting on webhooks.
 * Fail closed when the secret key is missing or the RC call fails.
 */

import {
  planFromEntitlementIds,
  planFromProductId,
  type PlanId,
} from "./subscriptionSync.js";

export type RevenueCatVerifyResult =
  | {
      ok: true;
      planId: PlanId;
      storeKitActive: boolean;
      status: string;
      productId: string | null;
      expiresAt: Date | null;
      managementUrl: string | null;
      entitlementIds: string[];
      productIds: string[];
    }
  | { ok: false; reason: "no_secret" | "http_error" | "parse_error" | "inactive" };

function revenueCatSecret(): string {
  return (
    process.env.REVENUECAT_SECRET_API_KEY?.trim() ||
    process.env.REVENUECAT_API_KEY?.trim() ||
    ""
  );
}

export function isRevenueCatServerVerifyConfigured(): boolean {
  return revenueCatSecret().length > 0;
}

type RcEntitlement = {
  expires_date?: string | null;
  product_identifier?: string | null;
  purchase_date?: string | null;
};

type RcSubscription = {
  expires_date?: string | null;
  product_identifier?: string | null;
  unsubscribe_detected_at?: string | null;
  billing_issues_detected_at?: string | null;
  is_sandbox?: boolean;
};

/**
 * Pure parse of a RevenueCat GET /v1/subscribers/{id} JSON body.
 * Never trusts client fields — only the RC subscriber payload.
 */
export function parseRevenueCatSubscriberPayload(
  body: unknown,
  nowMs: number = Date.now(),
): RevenueCatVerifyResult {
  if (!body || typeof body !== "object") {
    return { ok: false, reason: "parse_error" };
  }
  const root = body as {
    subscriber?: {
      entitlements?: Record<string, RcEntitlement>;
      subscriptions?: Record<string, RcSubscription>;
      management_url?: string | null;
    };
  };
  const sub = root.subscriber;
  if (!sub) return { ok: false, reason: "parse_error" };

  const entitlements = sub.entitlements ?? {};
  const activeEntitlementIds: string[] = [];
  let latestExpires: Date | null = null;
  let productId: string | null = null;

  for (const [id, ent] of Object.entries(entitlements)) {
    const expMs = ent.expires_date ? Date.parse(ent.expires_date) : NaN;
    // Lifetime / non-expiring entitlements omit expires_date.
    const active = !ent.expires_date || (Number.isFinite(expMs) && expMs > nowMs);
    if (!active) continue;
    activeEntitlementIds.push(id);
    if (Number.isFinite(expMs)) {
      const d = new Date(expMs);
      if (!latestExpires || d.getTime() > latestExpires.getTime()) latestExpires = d;
    }
    if (!productId && ent.product_identifier) productId = ent.product_identifier;
  }

  const subscriptions = sub.subscriptions ?? {};
  const productIds: string[] = [];
  for (const [pid, s] of Object.entries(subscriptions)) {
    productIds.push(pid);
    const expMs = s.expires_date ? Date.parse(s.expires_date) : NaN;
    const active = !s.expires_date || (Number.isFinite(expMs) && expMs > nowMs);
    if (active && Number.isFinite(expMs)) {
      const d = new Date(expMs);
      if (!latestExpires || d.getTime() > latestExpires.getTime()) latestExpires = d;
    }
    if (active && !productId) productId = s.product_identifier ?? pid;
  }

  const planFromEnt = planFromEntitlementIds(activeEntitlementIds);
  const planFromProd =
    productIds.map(planFromProductId).find((p) => p != null) ??
    planFromProductId(productId);
  const planId: PlanId = planFromEnt ?? planFromProd ?? "free";

  if (planId === "free") {
    return { ok: false, reason: "inactive" };
  }

  return {
    ok: true,
    planId,
    storeKitActive: true,
    status: "active",
    productId: productId ?? productIds[0] ?? null,
    expiresAt: latestExpires,
    managementUrl:
      typeof sub.management_url === "string" ? sub.management_url : null,
    entitlementIds: activeEntitlementIds,
    productIds,
  };
}

/**
 * Fetch subscriber from RevenueCat REST and map to a trusted entitlement.
 * Fail closed when secret missing or request fails.
 */
export async function verifyRevenueCatSubscriber(
  appUserId: string,
  opts: { fetchImpl?: typeof fetch } = {},
): Promise<RevenueCatVerifyResult> {
  const secret = revenueCatSecret();
  if (!secret) return { ok: false, reason: "no_secret" };
  const id = encodeURIComponent(appUserId);
  const fetchImpl = opts.fetchImpl ?? fetch;
  try {
    const res = await fetchImpl(`https://api.revenuecat.com/v1/subscribers/${id}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${secret}`,
        Accept: "application/json",
        // Do NOT send X-Platform — secret keys reject app-style platform headers.
      },
    });
    if (!res.ok) return { ok: false, reason: "http_error" };
    const json: unknown = await res.json();
    return parseRevenueCatSubscriberPayload(json);
  } catch {
    return { ok: false, reason: "http_error" };
  }
}
