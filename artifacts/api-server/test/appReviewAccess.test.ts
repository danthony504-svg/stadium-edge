import assert from "node:assert/strict";
import test from "node:test";

import { resolvePremiumApiAccess } from "../src/lib/appReviewAccess.ts";
import {
  clerkEmailsMatchDesignatedReview,
  readAppReviewEmail,
  readAppReviewEnv,
} from "../src/lib/appReviewAuth.ts";
import { isActivePaidEntitlement } from "../src/lib/subscriptionEntitlement.ts";

test("readAppReviewEmail does not require code; readAppReviewEnv still does", () => {
  assert.equal(
    readAppReviewEmail({ APP_REVIEW_EMAIL: " Apple@Stadiumedge.app " }),
    "apple@stadiumedge.app",
  );
  assert.equal(readAppReviewEmail({ APP_REVIEW_EMAIL: "" }), null);
  assert.equal(
    readAppReviewEnv({
      APP_REVIEW_EMAIL: "apple@stadiumedge.app",
      APP_REVIEW_CODE: undefined,
    }),
    null,
  );
});

test("clerkEmailsMatchDesignatedReview rejects forged / mismatched emails", () => {
  const designated = "apple@stadiumedge.app";
  assert.equal(
    clerkEmailsMatchDesignatedReview(["apple@stadiumedge.app"], designated),
    true,
  );
  assert.equal(
    clerkEmailsMatchDesignatedReview(["Apple@Stadiumedge.app"], designated),
    true,
  );
  assert.equal(
    clerkEmailsMatchDesignatedReview(["fan@example.com"], designated),
    false,
  );
  assert.equal(
    clerkEmailsMatchDesignatedReview(
      ["fan@example.com", "spoof@evil.com"],
      designated,
    ),
    false,
  );
  assert.equal(clerkEmailsMatchDesignatedReview([], designated), false);
  assert.equal(
    clerkEmailsMatchDesignatedReview(["apple@stadiumedge.app"], null),
    false,
  );
  // Client-supplied email alone is meaningless without designated server config.
  assert.equal(
    clerkEmailsMatchDesignatedReview(["apple@stadiumedge.app"], ""),
    false,
  );
});

test("resolvePremiumApiAccess: review OR paid; never invents paid from review alone in flags", () => {
  assert.equal(
    resolvePremiumApiAccess({ paidEntitlement: false, designatedAppReview: true }),
    true,
  );
  assert.equal(
    resolvePremiumApiAccess({ paidEntitlement: true, designatedAppReview: false }),
    true,
  );
  assert.equal(
    resolvePremiumApiAccess({ paidEntitlement: false, designatedAppReview: false }),
    false,
  );
});

test("expired paid entitlement stays locked even if client claims review email", () => {
  const expired = isActivePaidEntitlement({
    planId: "go",
    storeKitActive: false,
    status: "expired",
    expiresAt: new Date(Date.now() - 1000),
  });
  assert.equal(expired, false);
  assert.equal(
    resolvePremiumApiAccess({
      paidEntitlement: expired,
      designatedAppReview: false,
    }),
    false,
  );
});
