import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { readOwnerTestEmails } from "../src/lib/ownerTestAccess.ts";

test("readOwnerTestEmails still parses support@ and owner gmail", () => {
  assert.deepEqual(
    readOwnerTestEmails({
      OWNER_TEST_EMAILS: "support@stadiumedge.app, danthony504@gmail.com",
    }),
    ["support@stadiumedge.app", "danthony504@gmail.com"],
  );
});

test("entitlement route logs only sanitized entitlementDiag keys", () => {
  const src = readFileSync(
    join(process.cwd(), "src/routes/subscriptions.ts"),
    "utf8",
  );
  assert.match(src, /entitlement_diag/);
  assert.match(src, /authUserPresent/);
  assert.match(src, /clerkUserLookupSucceeded/);
  assert.match(src, /emailResolved/);
  assert.match(src, /allowlistMatched/);
  assert.match(src, /diagnoseOwnerTestAccess/);
  // Logger payload must be the diag object only — no secrets / identity fields.
  const loggerLine = src
    .split("\n")
    .find((line) => line.includes('logger.info({ entitlementDiag: diag }'));
  assert.ok(loggerLine, "expected entitlementDiag logger.info line");
  assert.equal(loggerLine!.includes("Authorization"), false);
  assert.equal(loggerLine!.includes("emailAddress"), false);
  assert.equal(loggerLine!.includes("userId"), false);
  assert.equal(loggerLine!.includes("Bearer"), false);
  assert.equal(loggerLine!.includes("CLERK"), false);
});

test("ownerTestAccess warn path no longer includes userId in log object", () => {
  const src = readFileSync(
    join(process.cwd(), "src/lib/ownerTestAccess.ts"),
    "utf8",
  );
  assert.match(src, /owner test access: Clerk user lookup failed/);
  assert.equal(
    /logger\.warn\(\s*\{\s*err,\s*path:\s*"owner-test-access",\s*userId/.test(src),
    false,
  );
});
