import test from "node:test";
import assert from "node:assert/strict";
import {
  canonicalReferralEmail,
  decryptOffer,
  encryptOffer,
  isNewReferralAccount,
  legacyReferralCode,
  normalizeReferralCode,
  referralEmailHash,
  referralProgramEnabled,
  REFERRAL_MILESTONES,
} from "../src/lib/referralPolicy.js";
process.env.REFERRAL_REWARDS_KEY = "12".repeat(32);
test("only 3/10 verified new friends unlock the once-only milestones", () => {
  assert.deepEqual(
    REFERRAL_MILESTONES.map((m) => m.count),
    [3, 10],
  );
  const now = Date.now();
  assert.equal(isNewReferralAccount(now, now), true);
  assert.equal(isNewReferralAccount(now - 7 * 86400000 - 1, now), false);
  assert.equal(isNewReferralAccount(now + 1, now), false);
  assert.equal(isNewReferralAccount(NaN, now), false);
});
test("duplicate verified gmail aliases cannot create extra credits", () => {
  assert.equal(
    canonicalReferralEmail(" Test.User+invite@googlemail.com "),
    "testuser@gmail.com",
  );
  assert.equal(
    referralEmailHash("Test.User@gmail.com"),
    referralEmailHash("testuser+2@googlemail.com"),
  );
  assert.notEqual(
    referralEmailHash("other@gmail.com"),
    referralEmailHash("testuser@gmail.com"),
  );
});
test("legacy codes remain valid while malformed codes are rejected", () => {
  assert.equal(legacyReferralCode("user_abcd1234"), "ABCD1234");
  for (const x of ["<script>", {}, "abc", null])
    assert.equal(normalizeReferralCode(x), null);
});
test("Apple inventory is encrypted, authenticated, and fails closed with no key", () => {
  const secret = "TESTAPPLEOFFER12345";
  const encrypted = encryptOffer(secret);
  assert.ok(!encrypted.includes(secret));
  assert.equal(decryptOffer(encrypted), secret);
  const parts = encrypted.split(".");
  parts[2] = Buffer.from("tampered").toString("base64url");
  assert.throws(() => decryptOffer(parts.join(".")));
  const key = process.env.REFERRAL_REWARDS_KEY;
  delete process.env.REFERRAL_REWARDS_KEY;
  process.env.REFERRAL_PROGRAM_ENABLED = "true";
  assert.equal(referralProgramEnabled(), false);
  assert.throws(() => encryptOffer(secret));
  process.env.REFERRAL_REWARDS_KEY = key;
  delete process.env.REFERRAL_PROGRAM_ENABLED;
  assert.equal(referralProgramEnabled(), false);
});
