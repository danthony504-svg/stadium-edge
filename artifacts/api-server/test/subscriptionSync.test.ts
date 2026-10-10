import assert from "node:assert/strict";
import test from "node:test";

import {
  claimedPlanFromClientCatalog,
  resolveTrustedEntitlementForClientSync,
} from "../src/lib/subscriptionSync.ts";

test("forged planId alone never grants premium", () => {
  const out = resolveTrustedEntitlementForClientSync({
    existing: null,
    body: { planId: "pro", storeKitActive: true },
  });
  assert.equal(out.planId, "free");
  assert.equal(out.storeKitActive, false);
  assert.equal(out.ignoredClientGrantFields, true);
});

test("forged productIds / entitlementIds never grant premium without DB row", () => {
  const out = resolveTrustedEntitlementForClientSync({
    existing: null,
    body: {
      planId: "go",
      productIds: ["com.stadiumedge.app.go.weekly"],
      entitlementIds: ["go"],
      storeKitActive: true,
    },
  });
  assert.equal(out.planId, "free");
  assert.equal(out.storeKitActive, false);
  assert.equal(out.claimedPlanFromCatalog, "go");
});

test("expired / refunded / revoked DB rows stay locked despite client claims", () => {
  for (const status of ["expired", "refunded", "revoked", "paused"] as const) {
    const out = resolveTrustedEntitlementForClientSync({
      existing: {
        planId: "pro",
        storeKitActive: true,
        status,
        expiresAt: null,
        productId: "com.stadiumedge.app.pro.monthly",
        source: "revenuecat",
      },
      body: {
        planId: "pro",
        productIds: ["com.stadiumedge.app.pro.monthly"],
        entitlementIds: ["pro"],
        storeKitActive: true,
      },
    });
    assert.equal(out.storeKitActive, false, status);
    assert.equal(out.planId, "free", status);
  }
});

test("trusted active RevenueCat row is preserved; client cannot escalate plan", () => {
  const out = resolveTrustedEntitlementForClientSync({
    existing: {
      planId: "go",
      storeKitActive: true,
      status: "active",
      expiresAt: new Date(Date.now() + 86_400_000),
      productId: "com.stadiumedge.app.go.weekly",
      source: "revenuecat",
      managementUrl: "https://apps.apple.com/account/subscriptions",
    },
    body: {
      planId: "pro",
      productIds: ["com.stadiumedge.app.pro.monthly"],
      entitlementIds: ["pro"],
      managementUrl: "https://apps.apple.com/account/subscriptions?ref=restore",
    },
  });
  assert.equal(out.planId, "go");
  assert.equal(out.storeKitActive, true);
  assert.equal(out.source, "revenuecat");
  assert.match(out.managementUrl ?? "", /restore/);
});

test("cancelled-until-expiry stays active when expiresAt is future", () => {
  const out = resolveTrustedEntitlementForClientSync({
    existing: {
      planId: "go",
      storeKitActive: true,
      status: "cancelled",
      expiresAt: new Date(Date.now() + 86_400_000),
      productId: "com.stadiumedge.app.go.weekly",
      source: "revenuecat",
    },
    body: { planId: "free", productIds: [], storeKitActive: false },
  });
  assert.equal(out.storeKitActive, true);
  assert.equal(out.planId, "go");
});

test("claimedPlanFromClientCatalog is audit-only mapping", () => {
  assert.equal(
    claimedPlanFromClientCatalog({
      productIds: ["com.stadiumedge.app.pro.monthly"],
    }),
    "pro",
  );
  assert.equal(claimedPlanFromClientCatalog({ entitlementIds: ["go"] }), "go");
  assert.equal(claimedPlanFromClientCatalog({ planId: "pro" }), null);
});
