import assert from "node:assert/strict";
import { test } from "node:test";

import { buildReferralLink, referralCodeFromUserId } from "./referral.ts";

test("referralCodeFromUserId strips the user_ prefix and uppercases an 8-char tail", () => {
  assert.equal(referralCodeFromUserId("user_2abcDEF901234567"), "01234567");
  assert.equal(referralCodeFromUserId("user_abcd1234"), "ABCD1234");
});

test("referralCodeFromUserId is stable for the same id", () => {
  const id = "user_2NkQ9xZ7pLmRtUvW";
  assert.equal(referralCodeFromUserId(id), referralCodeFromUserId(id));
});

test("referralCodeFromUserId returns null for missing/empty ids (no fabrication)", () => {
  assert.equal(referralCodeFromUserId(null), null);
  assert.equal(referralCodeFromUserId(undefined), null);
  assert.equal(referralCodeFromUserId(""), null);
  assert.equal(referralCodeFromUserId("user_"), null);
  assert.equal(referralCodeFromUserId("____"), null);
});

test("buildReferralLink builds an https link with the code as ?ref", () => {
  assert.equal(
    buildReferralLink("user_abcd1234", "stadium.example.com"),
    "https://stadium.example.com/?ref=ABCD1234",
  );
});

test("buildReferralLink respects an explicit scheme and trims trailing slashes", () => {
  assert.equal(
    buildReferralLink("user_abcd1234", "https://stadium.example.com/"),
    "https://stadium.example.com/?ref=ABCD1234",
  );
});

test("buildReferralLink returns null without a real id or domain (never a placeholder URL)", () => {
  assert.equal(buildReferralLink(null, "stadium.example.com"), null);
  assert.equal(buildReferralLink("user_abcd1234", null), null);
  assert.equal(buildReferralLink("user_abcd1234", "   "), null);
});
