/**
 * Fail-closed client subscription sync helpers.
 *
 * POST /subscriptions/sync must never grant Go/Pro from client-supplied
 * planId / storeKitActive / productIds / entitlementIds. Paid access comes
 * only from trusted server records (RevenueCat webhooks → DB), validated by
 * isActivePaidEntitlement.
 */

import {
  isActivePaidEntitlement,
  type ServerEntitlementRow,
} from "./subscriptionEntitlement.js";

export type PlanId = "free" | "go" | "pro";

export type ExistingEntitlementRow = ServerEntitlementRow & {
  productId?: string | null;
  managementUrl?: string | null;
  originalAppUserId?: string | null;
  source?: string | null;
};

export type ClientSyncBody = {
  planId?: unknown;
  storeKitActive?: unknown;
  productIds?: unknown;
  entitlementIds?: unknown;
  managementUrl?: unknown;
  originalAppUserId?: unknown;
};

export type TrustedSyncResult = {
  planId: PlanId;
  storeKitActive: boolean;
  status: string;
  productId: string | null;
  expiresAt: Date | null;
  managementUrl: string | null;
  originalAppUserId: string | null;
  source: string;
  /** Catalog claim parsed from body for audit only — never used to grant. */
  claimedPlanFromCatalog: "go" | "pro" | null;
  /** True when body.planId / storeKitActive were ignored for entitlement. */
  ignoredClientGrantFields: boolean;
};

/** Map RevenueCat / StoreKit product identifiers → plan (catalog only). */
export function planFromProductId(productId: string | null | undefined): "go" | "pro" | null {
  if (!productId) return null;
  if (productId === "com.stadiumedge.app.pro.monthly") return "pro";
  if (productId === "com.stadiumedge.app.go.weekly") return "go";
  const lower = productId.toLowerCase();
  if (lower.includes("pro.monthly") || lower.endsWith(".pro.monthly")) return "pro";
  if (lower.includes("go.weekly") || lower.endsWith(".go.weekly")) return "go";
  return null;
}

export function planFromEntitlementIds(ids: unknown): "go" | "pro" | null {
  if (!Array.isArray(ids)) return null;
  const lower = ids.map((id) => String(id).toLowerCase());
  if (lower.includes("pro")) return "pro";
  if (lower.includes("go")) return "go";
  return null;
}

/** Audit-only: what the client claims from catalog fields (never grants access). */
export function claimedPlanFromClientCatalog(body: ClientSyncBody): "go" | "pro" | null {
  const productIds: string[] = Array.isArray(body.productIds)
    ? body.productIds.map(String)
    : [];
  return (
    planFromEntitlementIds(body.entitlementIds) ??
    productIds.map(planFromProductId).find((p) => p != null) ??
    null
  );
}

function asOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Resolve the entitlement row to persist after a client sync.
 * Never upgrades to paid from the request body. Refreshes metadata only.
 */
export function resolveTrustedEntitlementForClientSync(opts: {
  existing: ExistingEntitlementRow | null | undefined;
  body: ClientSyncBody;
}): TrustedSyncResult {
  const body = opts.body ?? {};
  const claimedPlanFromCatalog = claimedPlanFromClientCatalog(body);
  const ignoredClientGrantFields =
    body.planId !== undefined ||
    body.storeKitActive !== undefined ||
    claimedPlanFromCatalog != null;

  const metaUrl = asOptionalString(body.managementUrl);
  const metaAppUser = asOptionalString(body.originalAppUserId);

  const existing = opts.existing ?? null;
  if (existing && isActivePaidEntitlement(existing)) {
    const planId: PlanId =
      existing.planId === "go" || existing.planId === "pro" ? existing.planId : "free";
    return {
      planId,
      storeKitActive: true,
      status: existing.status || "active",
      productId: existing.productId ?? null,
      expiresAt: existing.expiresAt ?? null,
      managementUrl: metaUrl ?? existing.managementUrl ?? null,
      originalAppUserId: metaAppUser ?? existing.originalAppUserId ?? null,
      source: existing.source || "revenuecat",
      claimedPlanFromCatalog,
      ignoredClientGrantFields,
    };
  }

  // Fail closed: no trusted active entitlement → locked free/expired state.
  const status =
    existing?.status &&
    ["expired", "refunded", "revoked", "paused", "cancelled"].includes(
      existing.status.toLowerCase(),
    )
      ? existing.status
      : "expired";

  return {
    planId: "free",
    storeKitActive: false,
    status,
    productId: existing?.productId ?? null,
    expiresAt: existing?.expiresAt ?? null,
    managementUrl: metaUrl ?? existing?.managementUrl ?? null,
    originalAppUserId: metaAppUser ?? existing?.originalAppUserId ?? null,
    source: existing?.source || "client_sync",
    claimedPlanFromCatalog,
    ignoredClientGrantFields,
  };
}
