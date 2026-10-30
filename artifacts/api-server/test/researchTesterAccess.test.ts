import assert from "node:assert/strict";
import test from "node:test";

import { resolvePremiumApiAccess } from "../src/lib/appReviewAccess.ts";
import {
  readResearchTesterEmails,
  RESEARCH_NOT_VALIDATED_LABEL,
  researchTesterAllowlistMatch,
  verifiedEmailsFromClerkUser,
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

test("verifiedEmailsFromClerkUser: only verification.status=verified", () => {
  const emails = verifiedEmailsFromClerkUser({
    primaryEmailAddressId: "id_primary",
    primaryEmailAddress: {
      id: "id_primary",
      emailAddress: "tester@stadiumedge.app",
      verification: { status: "verified" },
    },
    emailAddresses: [
      {
        id: "id_primary",
        emailAddress: "tester@stadiumedge.app",
        verification: { status: "verified" },
      },
      {
        id: "id_unverified",
        emailAddress: "unverified@stadiumedge.app",
        verification: { status: "unverified" },
      },
      {
        id: "id_missing",
        emailAddress: "missing-verification@stadiumedge.app",
        verification: null,
      },
    ],
  });
  assert.deepEqual(emails, ["tester@stadiumedge.app"]);
});

test("verifiedEmailsFromClerkUser: rejects unverified primary even if on allowlist text", () => {
  const emails = verifiedEmailsFromClerkUser({
    primaryEmailAddress: {
      emailAddress: "tester@stadiumedge.app",
      verification: { status: "unverified" },
    },
    emailAddresses: [
      {
        emailAddress: "tester@stadiumedge.app",
        verification: { status: "unverified" },
      },
    ],
  });
  assert.deepEqual(emails, []);
});

test("researchTesterAllowlistMatch: verified only; client claims ignored", () => {
  const allowlist = readResearchTesterEmails({
    RESEARCH_TESTER_EMAILS: "tester@stadiumedge.app",
  });
  assert.equal(
    researchTesterAllowlistMatch({
      verifiedEmails: ["tester@stadiumedge.app"],
      allowlist,
    }),
    true,
  );
  assert.equal(
    researchTesterAllowlistMatch({
      verifiedEmails: ["Tester@Stadiumedge.app"],
      allowlist,
    }),
    true,
  );
  // Unverified address never reaches verifiedEmails — empty → deny.
  assert.equal(
    researchTesterAllowlistMatch({ verifiedEmails: [], allowlist }),
    false,
  );
  // Wrong email.
  assert.equal(
    researchTesterAllowlistMatch({
      verifiedEmails: ["fan@example.com"],
      allowlist,
    }),
    false,
  );
  // Empty allowlist deny.
  assert.equal(
    researchTesterAllowlistMatch({
      verifiedEmails: ["tester@stadiumedge.app"],
      allowlist: [],
    }),
    false,
  );
  // Client-supplied claim string is not a verification path — only verifiedEmails arg.
  assert.equal(
    researchTesterAllowlistMatch({
      verifiedEmails: [],
      allowlist,
    }),
    false,
  );
});

test("missing identity and empty allowlist never grant research access", () => {
  assert.equal(
    researchTesterAllowlistMatch({
      verifiedEmails: ["tester@stadiumedge.app"],
      allowlist: readResearchTesterEmails({}),
    }),
    false,
  );
  assert.equal(
    researchTesterAllowlistMatch({
      verifiedEmails: [],
      allowlist: readResearchTesterEmails({
        RESEARCH_TESTER_EMAILS: "tester@stadiumedge.app",
      }),
    }),
    false,
  );
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
