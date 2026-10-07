import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

describe("app-review-ticket temporary diagnostics", () => {
  const src = readFileSync(
    new URL("../src/routes/appReviewAuth.ts", import.meta.url),
    "utf8",
  );

  it("logs only safe boolean/status fields for ticket requests", () => {
    assert.match(src, /app-review-ticket request received/);
    assert.match(src, /emailPresent/);
    assert.match(src, /emailMatchesConfiguredReviewEmail/);
    assert.match(src, /codePresent/);
    assert.match(src, /codeMatchesConfiguredReviewCode/);
    assert.match(src, /finalHttpStatus/);
    // Must not log domain or raw credential fields in the diag payload.
    assert.doesNotMatch(
      src,
      /logTicketDiag[\s\S]{0,400}emailDomain/,
    );
    assert.doesNotMatch(
      src,
      /logger\.info\(\s*\{[^}]*emailDomain/,
    );
  });
});
