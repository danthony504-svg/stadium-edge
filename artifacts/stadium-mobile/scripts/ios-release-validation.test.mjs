import assert from "node:assert/strict";
import test from "node:test";
import { isIosRevenueCatKey, hasNativeWebCredentials } from "./ios-release-validation.mjs";

test("iOS gate rejects Android, test-store, secret and malformed SDK keys", () => {
  for (const value of ["", "goog_example", "test_example", "sk_example", "unknown", "appl_", "appl_a b"]) {
    assert.equal(isIosRevenueCatKey(value), false);
  }
  assert.equal(isIosRevenueCatKey("appl_example123"), true);
});

test("AASA requires an exact native webcredentials entry", () => {
  const bundle = "com.stadiumedge.app";
  for (const aasa of [null, {}, { applinks: { details: [{ appID: `ABCDEFGHIJ.${bundle}` }] } },
    { webcredentials: { apps: [bundle] } },
    { webcredentials: { apps: [`ABCDEFGHIJ.${bundle}.other`] } },
    { webcredentials: { apps: [`BAD.${bundle}`] } }]) {
    assert.equal(hasNativeWebCredentials(aasa, bundle), false);
  }
  assert.equal(hasNativeWebCredentials({ webcredentials: { apps: [`ABCDEFGHIJ.${bundle}`] } }, bundle), true);
});
