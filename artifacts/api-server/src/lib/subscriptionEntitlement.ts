/**
 * Pure subscription entitlement checks (no DB) for premium API responses.
 */

export type ServerEntitlementRow = {
  planId: string;
  storeKitActive: boolean;
  status: string;
  expiresAt: Date | null;
};

/** Active Go/Pro with StoreKit flag; expired / revoked / refunded stay locked. */
export function isActivePaidEntitlement(row: ServerEntitlementRow | null | undefined): boolean {
  if (!row) return false;
  if (!row.storeKitActive) return false;
  if (row.planId !== "go" && row.planId !== "pro") return false;
  const status = (row.status ?? "").toLowerCase();
  if (
    status === "expired" ||
    status === "refunded" ||
    status === "revoked" ||
    status === "paused"
  ) {
    return false;
  }
  if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) return false;
  // cancelled-at-expiration remains active until expiresAt
  return true;
}
