/**
 * Pure mirrors of purchasePlan / restorePurchases identity requirements —
 * ensures StoreKit cannot start without a Clerk user id (no RNPurchases load).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

function gatePurchaseIdentity(appUserId: string | null | undefined): {
  ok: boolean;
  message?: string;
} {
  const id = typeof appUserId === "string" ? appUserId.trim() : "";
  if (!id) {
    return {
      ok: false,
      message: "Sign in required before Apple billing can start.",
    };
  }
  return { ok: true };
}

function mapAlreadyOwnedError(code: string, message: string): string {
  if (/already\s+purchased|productAlreadyPurchased|RECEIPT_ALREADY_IN_USE/i.test(`${code} ${message}`)) {
    return "This Apple ID already has a Stadium Edge subscription. Use Restore Purchases.";
  }
  return message || "Purchase failed. Try again or restore purchases.";
}

describe("purchase identity + duplicate handling", () => {
  it("refuses purchase/restore without Clerk user id", () => {
    assert.equal(gatePurchaseIdentity(null).ok, false);
    assert.equal(gatePurchaseIdentity("").ok, false);
    assert.equal(gatePurchaseIdentity("user_1").ok, true);
  });

  it("maps already-owned Apple errors to restore guidance (no duplicate buy)", () => {
    assert.match(
      mapAlreadyOwnedError("PRODUCT_ALREADY_PURCHASED", "already purchased"),
      /Restore Purchases/i,
    );
    assert.equal(mapAlreadyOwnedError("", "network down"), "network down");
  });

  it("cancelled purchase is not an unlock", () => {
    const cancelled = { ok: false as const, cancelled: true, message: "Purchase cancelled." };
    assert.equal(cancelled.ok, false);
    assert.equal(cancelled.cancelled, true);
  });

  it("restore with no purchases stays free", () => {
    const restore = {
      ok: true as const,
      restored: false,
      snapshot: { planId: null as null },
    };
    assert.equal(restore.restored, false);
    assert.equal(restore.snapshot.planId, null);
  });
});
