import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  matchesAppReviewCredentials,
  normalizeReviewEmail,
  readAppReviewEnv,
} from "../src/lib/appReviewAuth";

describe("appReviewAuth", () => {
  it("normalizes review email", () => {
    assert.equal(normalizeReviewEmail("  Review@Example.COM "), "review@example.com");
  });

  it("readAppReviewEnv requires both email and code", () => {
    assert.equal(readAppReviewEnv({}), null);
    assert.equal(readAppReviewEnv({ APP_REVIEW_EMAIL: "a@b.com" }), null);
    assert.equal(readAppReviewEnv({ APP_REVIEW_CODE: "123456" }), null);
    assert.deepEqual(
      readAppReviewEnv({
        APP_REVIEW_EMAIL: " Apple@Stadiumedge.app ",
        APP_REVIEW_CODE: " FIXED-CODE ",
      }),
      { email: "apple@stadiumedge.app", code: "FIXED-CODE" },
    );
  });

  it("matches only the designated email + code", () => {
    const cfg = { email: "apple@stadiumedge.app", code: "SE-REVIEW-ONLY" };
    assert.equal(
      matchesAppReviewCredentials("apple@stadiumedge.app", "SE-REVIEW-ONLY", cfg),
      true,
    );
    assert.equal(
      matchesAppReviewCredentials("APPLE@stadiumedge.app", "SE-REVIEW-ONLY", cfg),
      true,
    );
    assert.equal(
      matchesAppReviewCredentials("other@stadiumedge.app", "SE-REVIEW-ONLY", cfg),
      false,
    );
    assert.equal(
      matchesAppReviewCredentials("apple@stadiumedge.app", "wrong", cfg),
      false,
    );
    assert.equal(
      matchesAppReviewCredentials("apple@stadiumedge.app", "SE-REVIEW-ONLY", null),
      false,
    );
  });
});
