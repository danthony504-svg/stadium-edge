import assert from "node:assert/strict";
import test from "node:test";

import { resolvePremiumApiAccess } from "../src/lib/appReviewAccess.ts";
import {
  clerkEmailsMatchAllowlist,
  clerkEmailsMatchDesignatedReview,
  readAppReviewEmail,
  readAppReviewEnv,
} from "../src/lib/appReviewAuth.ts";
import { readOwnerTestEmails } from "../src/lib/ownerTestAccess.ts";
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
  assert.equal(
    clerkEmailsMatchDesignatedReview(["apple@stadiumedge.app"], ""),
    false,
  );
});

test("owner allowlist: only server env emails; forged non-owner rejected", () => {
  assert.deepEqual(
    readOwnerTestEmails({ OWNER_TEST_EMAILS: "danthony504@gmail.com" }),
    ["danthony504@gmail.com"],
  );
  assert.deepEqual(
    readOwnerTestEmails({ ADMIN_EMAILS: "danthony504@gmail.com, other@x.com" }),
    ["danthony504@gmail.com", "other@x.com"],
  );
  // EXPO_PUBLIC_ADMIN_EMAILS must never be read by server owner helper.
  assert.deepEqual(
    readOwnerTestEmails({
      EXPO_PUBLIC_ADMIN_EMAILS: "danthony504@gmail.com",
    }),
    [],
  );
  assert.equal(
    clerkEmailsMatchAllowlist(
      ["danthony504@gmail.com"],
      readOwnerTestEmails({ OWNER_TEST_EMAILS: "danthony504@gmail.com" }),
    ),
    true,
  );
  assert.equal(
    clerkEmailsMatchAllowlist(
      ["fan@example.com"],
      readOwnerTestEmails({ OWNER_TEST_EMAILS: "danthony504@gmail.com" }),
    ),
    false,
  );
});

test("resolvePremiumApiAccess: review OR owner OR paid; free stays locked", () => {
  assert.equal(
    resolvePremiumApiAccess({
      paidEntitlement: false,
      designatedAppReview: true,
    }),
    true,
  );
  assert.equal(
    resolvePremiumApiAccess({
      paidEntitlement: false,
      designatedAppReview: false,
      designatedOwnerTest: true,
    }),
    true,
  );
  assert.equal(
    resolvePremiumApiAccess({
      paidEntitlement: true,
      designatedAppReview: false,
      designatedOwnerTest: false,
    }),
    true,
  );
  assert.equal(
    resolvePremiumApiAccess({
      paidEntitlement: false,
      designatedAppReview: false,
      designatedOwnerTest: false,
    }),
    false,
  );
});

test("expired paid entitlement stays locked without server privileged flags", () => {
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
      designatedOwnerTest: false,
    }),
    false,
  );
});
