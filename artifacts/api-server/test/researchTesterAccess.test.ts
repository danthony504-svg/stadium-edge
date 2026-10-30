import assert from "node:assert/strict";
import test from "node:test";

import { resolvePremiumApiAccess } from "../src/lib/appReviewAccess.ts";
import { clerkEmailsMatchAllowlist } from "../src/lib/appReviewAuth.ts";
import {
  readResearchTesterEmails,
  RESEARCH_NOT_VALIDATED_LABEL,
} from "../src/lib/researchTesterAccess.ts";

test("readResearchTesterEmails: server env only; deny by default", () => {
  assert.deepEqual(readResearchTesterEmails({}), []);
  assert.deepEqual(readResearchTesterEmails({ RESEARCH_TESTER_EMAILS: "" }), []);
  assert.deepEqual(
    readResearchTesterEmails({
      RESEARCH_TESTER_EMAILS: " tester@stadiumedge.app , Other@X.com ",
    }),
    ["tester@stadiumedge.app", "other@x.com"],
  );
  // Client / Expo public allowlists must never be consulted.
  assert.deepEqual(
    readResearchTesterEmails({
      EXPO_PUBLIC_RESEARCH_TESTER_EMAILS: "tester@stadiumedge.app",
      EXPO_PUBLIC_ADMIN_EMAILS: "tester@stadiumedge.app",
    }),
    [],
  );
});

test("research allowlist match rejects forged non-tester emails", () => {
  const allow = readResearchTesterEmails({
    RESEARCH_TESTER_EMAILS: "tester@stadiumedge.app",
  });
  assert.equal(clerkEmailsMatchAllowlist(["tester@stadiumedge.app"], allow), true);
  assert.equal(
    clerkEmailsMatchAllowlist(["Tester@Stadiumedge.app"], allow),
    true,
  );
  assert.equal(clerkEmailsMatchAllowlist(["fan@example.com"], allow), false);
  assert.equal(clerkEmailsMatchAllowlist([], allow), false);
});

test("resolvePremiumApiAccess: research tester unlocks Coach API without paid row", () => {
  assert.equal(
    resolvePremiumApiAccess({
      paidEntitlement: false,
      designatedAppReview: false,
      designatedOwnerTest: false,
      designatedResearchTester: true,
    }),
    true,
  );
  assert.equal(
    resolvePremiumApiAccess({
      paidEntitlement: false,
      designatedAppReview: false,
      designatedOwnerTest: false,
      designatedResearchTester: false,
    }),
    false,
  );
});

test("research disclaimer never claims subscriber validation", () => {
  assert.equal(RESEARCH_NOT_VALIDATED_LABEL, "Research — not validated.");
  assert.doesNotMatch(RESEARCH_NOT_VALIDATED_LABEL, /subscriber|approved|release/i);
});
