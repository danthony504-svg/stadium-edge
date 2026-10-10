import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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

/** Mirrors snapshotFromCustomerInfo entitlement extraction (fail-closed). */
function activeEntitlementIdsFromInfo(info: {
  entitlements?: { active?: Record<string, unknown> | null } | null;
}): string[] {
  const active = info.entitlements?.active ?? {};
  return Object.keys(active);
}

test("never require purchases JS when RNPurchases native module is missing", () => {
  assert.equal(shouldRequirePurchasesJs({ platform: "ios", hasRnPurchases: false }), false);
  assert.equal(shouldRequirePurchasesJs({ platform: "android", hasRnPurchases: false }), false);
});

test("allow require only when native module is present on mobile", () => {
  assert.equal(shouldRequirePurchasesJs({ platform: "ios", hasRnPurchases: true }), true);
  assert.equal(shouldRequirePurchasesJs({ platform: "web", hasRnPurchases: true }), false);
});

test("missing CustomerInfo.entitlements does not Object.keys(undefined)", () => {
  assert.deepEqual(activeEntitlementIdsFromInfo({}), []);
  assert.deepEqual(activeEntitlementIdsFromInfo({ entitlements: null }), []);
  assert.deepEqual(activeEntitlementIdsFromInfo({ entitlements: { active: undefined } }), []);
  assert.throws(
    () => Object.keys(undefined as never),
    (err: unknown) =>
      err instanceof TypeError &&
      /Cannot convert undefined or null to object|Cannot convert undefined value to object/i.test(
        (err as Error).message,
      ),
  );
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "purchases.ts"), "utf8");
  assert.match(src, /info\.entitlements\?\.active \?\? \{\}/);
});
