import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

describe("app-review-selfcheck route (source contract)", () => {
  const src = readFileSync(
    new URL("../src/routes/appReviewAuth.ts", import.meta.url),
    "utf8",
  );

  it("is temporary, gated, and never returns ticket/email/code fields", () => {
    assert.match(src, /\/auth\/app-review-selfcheck/);
    assert.match(src, /APP_REVIEW_SELFCHECK/);
    assert.match(src, /result:\s*"PASS"/);
    assert.match(src, /result:\s*"FAIL"/);
    // Success body is only { result: "PASS" } — no ticket field.
    assert.match(src, /json\(\{\s*result:\s*"PASS"\s*\}\)/);
    assert.doesNotMatch(src, /json\(\{\s*result:\s*"PASS"[^}]*ticket/);
  });
});

