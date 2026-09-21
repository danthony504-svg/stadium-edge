import assert from "node:assert/strict";
import test from "node:test";

import {
  STOREKIT_PRODUCT_IDS,
  planIdForProductId,
  planIdFromEntitlements,
  productIdForPlan,
} from "./storekitProducts.ts";

test("productIdForPlan maps go/pro and ignores free", () => {
  assert.equal(productIdForPlan("go"), STOREKIT_PRODUCT_IDS.goWeekly);
  assert.equal(productIdForPlan("pro"), STOREKIT_PRODUCT_IDS.proMonthly);
  assert.equal(productIdForPlan("free"), null);
});

test("planIdForProductId reverses App Store product ids", () => {
  assert.equal(planIdForProductId(STOREKIT_PRODUCT_IDS.goWeekly), "go");
  assert.equal(planIdForProductId(STOREKIT_PRODUCT_IDS.proMonthly), "pro");
  assert.equal(planIdForProductId("unknown"), null);
  assert.equal(planIdForProductId(null), null);
});

test("planIdFromEntitlements prefers pro over go", () => {
  assert.equal(planIdFromEntitlements(["go", "pro"]), "pro");
  assert.equal(planIdFromEntitlements(["go"]), "go");
  assert.equal(planIdFromEntitlements([]), null);
  assert.equal(
    planIdFromEntitlements([], [STOREKIT_PRODUCT_IDS.proMonthly]),
    "pro",
  );
  assert.equal(
    planIdFromEntitlements([], [STOREKIT_PRODUCT_IDS.goWeekly]),
    "go",
  );
});
