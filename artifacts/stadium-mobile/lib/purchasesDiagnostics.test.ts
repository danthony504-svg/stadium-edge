import assert from "node:assert/strict";
import test from "node:test";

import {
  describePurchasesError,
  rcDiagnosticAlert,
  revenueCatKeyPrefixType,
} from "./purchasesDiagnostics.ts";

test("revenueCatKeyPrefixType classifies without exposing the key", () => {
  assert.equal(revenueCatKeyPrefixType(""), "missing");
  assert.equal(revenueCatKeyPrefixType("appl_abc123"), "appl_");
  assert.equal(revenueCatKeyPrefixType("test_abc123"), "test_");
  assert.equal(revenueCatKeyPrefixType("sk_live_x"), "other");
});

test("rcDiagnosticAlert prefixes and clips long detail", () => {
  assert.equal(rcDiagnosticAlert("getProducts returned 0 products"), "RC diagnostic: getProducts returned 0 products");
  assert.equal(rcDiagnosticAlert("RC diagnostic: already"), "RC diagnostic: already");
  const long = "x".repeat(200);
  const out = rcDiagnosticAlert(long);
  assert.ok(out.startsWith("RC diagnostic:"));
  assert.ok(out.length <= 175);
});

test("describePurchasesError extracts code/message and redacts key-like strings", () => {
  const d = describePurchasesError({
    code: "23",
    message: "Products could not be fetched",
    underlyingErrorMessage: "STORE_PROBLEM",
  });
  assert.equal(d.code, "23");
  assert.equal(d.message, "Products could not be fetched");
  assert.ok(d.short.includes("23"));
  assert.ok(d.short.includes("Products could not be fetched"));

  const redacted = describePurchasesError({
    code: "1",
    message: "bad",
    apiKey: "appl_should_not_appear_in_clear",
  });
  assert.ok(!redacted.serialized.includes("appl_should_not_appear_in_clear"));
  assert.ok(redacted.serialized.includes("[redacted]"));
});
