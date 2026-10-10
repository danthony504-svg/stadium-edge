import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

test("fetchServerAccessFlags records token race and response booleans", () => {
  const src = readFileSync(join(process.cwd(), "lib/subscriptionApi.ts"), "utf8");
  assert.match(src, /\[entitlement-diag\]/);
  assert.match(src, /tokenPresent/);
  assert.match(src, /requestStarted/);
  assert.match(src, /abortedBeforeRequestNoToken/);
  assert.match(src, /ownerAccessReceived/);
  assert.match(src, /subFetchDetailed/);
});

test("SubscriptionContext logs contextAppliedOwnerAccess without userId/email", () => {
  const src = readFileSync(
    join(process.cwd(), "context/SubscriptionContext.tsx"),
    "utf8",
  );
  assert.match(src, /contextAppliedOwnerAccess/);
  assert.match(src, /\[entitlement-diag\]/);
  // Only the logged JSON payload — not surrounding effect deps like userId.
  const payloadStart = src.indexOf("JSON.stringify({\n            contextAppliedOwnerAccess");
  assert.ok(payloadStart >= 0);
  const payload = src.slice(payloadStart, payloadStart + 220);
  assert.match(payload, /contextAppliedOwnerAccess/);
  assert.match(payload, /flagsReceived/);
  assert.match(payload, /ownerAccessReceived/);
  assert.equal(payload.includes("userId"), false);
  assert.equal(payload.includes("email"), false);
  assert.equal(payload.includes("Authorization"), false);
});
