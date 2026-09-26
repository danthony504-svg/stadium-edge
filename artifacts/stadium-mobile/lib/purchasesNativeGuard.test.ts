import assert from "node:assert/strict";
import test from "node:test";

/**
 * Pure guard logic mirrored from purchases.ts — kept dependency-free so we can
 * unit-test the OTA crash rule without loading react-native.
 */
function shouldRequirePurchasesJs(opts: {
  platform: string;
  hasRnPurchases: boolean;
}): boolean {
  if (opts.platform === "web") return false;
  return opts.hasRnPurchases;
}

test("never require purchases JS when RNPurchases native module is missing", () => {
  assert.equal(shouldRequirePurchasesJs({ platform: "ios", hasRnPurchases: false }), false);
  assert.equal(shouldRequirePurchasesJs({ platform: "android", hasRnPurchases: false }), false);
});

test("allow require only when native module is present on mobile", () => {
  assert.equal(shouldRequirePurchasesJs({ platform: "ios", hasRnPurchases: true }), true);
  assert.equal(shouldRequirePurchasesJs({ platform: "web", hasRnPurchases: true }), false);
});
