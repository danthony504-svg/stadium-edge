import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  classifyClerkLookupError,
  clerkPublishableKeyMode,
  clerkSecretKeyMode,
} from "../src/lib/clerkLookupDiag.ts";

test("clerkSecretKeyMode detects test/live/missing without reading secret body", () => {
  assert.equal(clerkSecretKeyMode({ CLERK_SECRET_KEY: "sk_test_abc" }), "test");
  assert.equal(clerkSecretKeyMode({ CLERK_SECRET_KEY: "sk_live_abc" }), "live");
  assert.equal(clerkSecretKeyMode({}), "missing");
  assert.equal(clerkSecretKeyMode({ CLERK_SECRET_KEY: "other" }), "unknown");
});

test("clerkPublishableKeyMode detects pk_test/pk_live", () => {
  assert.equal(
    clerkPublishableKeyMode({ CLERK_PUBLISHABLE_KEY: "pk_test_x" }),
    "test",
  );
  assert.equal(
    clerkPublishableKeyMode({ CLERK_PUBLISHABLE_KEY: "pk_live_x" }),
    "live",
  );
});

test("classifyClerkLookupError maps HTTP status buckets", () => {
  assert.equal(
    classifyClerkLookupError({ status: 401, errors: [{ code: "authentication_invalid" }] })
      .clerkFailureCategory,
    "unauthorized",
  );
  assert.equal(
    classifyClerkLookupError({ status: 403, code: "authorization_invalid" })
      .clerkFailureCategory,
    "forbidden",
  );
  assert.equal(
    classifyClerkLookupError({ status: 404, errors: [{ code: "resource_not_found" }] })
      .clerkFailureCategory,
    "not_found",
  );
  assert.equal(
    classifyClerkLookupError({ status: 429 }).clerkFailureCategory,
    "rate_limited",
  );
  assert.equal(
    classifyClerkLookupError({ name: "TypeError", message: "fetch failed" })
      .clerkFailureCategory,
    "network",
  );
});

test("entitlement 500 path preserves ownerDiag and reports routeFailureStage", () => {
  const src = readFileSync(
    join(process.cwd(), "src/routes/subscriptions.ts"),
    "utf8",
  );
  assert.match(src, /routeFailureStage/);
  assert.match(src, /clerkFailureCategory/);
  assert.match(src, /secretKeyMode/);
  assert.match(src, /dbErrorCode/);
  assert.match(src, /ownerDiag\?\.clerkUserLookupSucceeded/);
  // Must not log Authorization / email / userId in the diag logger call site payload keys.
  const loggerLine = src
    .split("\n")
    .find((line) => line.includes('logger.info({ entitlementDiag: diag }'));
  assert.ok(loggerLine);
  assert.equal(loggerLine!.includes("userId"), false);
  assert.equal(loggerLine!.includes("Authorization"), false);
});

test("ownerTestAccess warn path logs sanitized clerk fields only", () => {
  const src = readFileSync(
    join(process.cwd(), "src/lib/ownerTestAccess.ts"),
    "utf8",
  );
  assert.match(src, /clerkFailureCategory/);
  assert.equal(
    /logger\.warn\(\s*\{\s*err,/.test(src),
    false,
  );
});
