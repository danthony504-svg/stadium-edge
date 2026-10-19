import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildReferralLink,
  normalizeReferralCode,
  validPendingInvite,
} from "./referral.ts";
import { resolvePostAuthHref } from "./pendingSubscriptionIntent.ts";
test("server-issued invites use the real landing route", () => {
  assert.equal(
    buildReferralLink("KKDECI4H", "stadium-edge.onrender.com"),
    "https://stadium-edge.onrender.com/invite/KKDECI4H",
  );
  assert.equal(
    buildReferralLink(" kkdeci4h ", "https://stadium-edge.onrender.com/"),
    "https://stadium-edge.onrender.com/invite/KKDECI4H",
  );
});
test("invalid hosts and raw account ids never become invite links", () => {
  for (const host of [
    null,
    "",
    "http://example.com",
    "https://user:pass@example.com",
    "https://example.com/path",
    "https://example.com/?evil=1",
  ])
    assert.equal(buildReferralLink("ABCDEFGH", host), null);
  for (const code of [null, [], "user_abcdefgh", "abc", "<script>"])
    assert.equal(normalizeReferralCode(code), null);
});
test("pending invites survive auth for seven days and reject corrupted timestamps", () => {
  const now = 2000000000;
  assert.deepEqual(
    validPendingInvite({ code: "abcdefgh", at: now - 100 }, now),
    { code: "ABCDEFGH", at: now - 100 },
  );
  for (const at of [now + 1, now - 7 * 86400000, NaN, "100"])
    assert.equal(validPendingInvite({ code: "ABCDEFGH", at }, now), null);
});
test("invited signup returns to Account without consuming an old purchase intent", () => {
  assert.equal(
    resolvePostAuthHref({
      returnTo: "account",
      stored: { intent: "purchase", planId: "pro" },
    }),
    "/account",
  );
  assert.equal(resolvePostAuthHref({ returnTo: "https://evil.example" }), "/");
});
