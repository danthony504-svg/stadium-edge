import assert from "node:assert/strict";
import { test } from "node:test";
import {
  STOREKIT_PRODUCT_IDS,
  planIdForProductId,
  productIdForPlan,
} from "./storekitProducts.ts";

test("Go maps to weekly StoreKit product id", () => {
  assert.equal(productIdForPlan("go"), "com.stadiumedge.app.go.weekly");
  assert.equal(STOREKIT_PRODUCT_IDS.goWeekly, "com.stadiumedge.app.go.weekly");
  assert.equal(planIdForProductId("com.stadiumedge.app.go.weekly"), "go");
});

test("Pro maps to monthly StoreKit product id", () => {
  assert.equal(productIdForPlan("pro"), "com.stadiumedge.app.pro.monthly");
  assert.equal(STOREKIT_PRODUCT_IDS.proMonthly, "com.stadiumedge.app.pro.monthly");
  assert.equal(planIdForProductId("com.stadiumedge.app.pro.monthly"), "pro");
});
