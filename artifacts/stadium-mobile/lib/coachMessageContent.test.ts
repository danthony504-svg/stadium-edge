import assert from "node:assert/strict";
import test from "node:test";

import { isCoachDiagnosticContent, visibleCoachMessageContent } from "./coachMessageContent.ts";

test("successful HTTP diagnostics never become visible Coach messages", () => {
  for (const value of [1, "1", "HTTP 200", "HTTP 201", "HTTP 503", "req_abc123", "123e4567-e89b-12d3-a456-426614174000"]) {
    assert.equal(isCoachDiagnosticContent(value), true);
    assert.equal(visibleCoachMessageContent(value), "");
  }
});

test("useful Coach explanations remain visible", () => {
  assert.equal(
    visibleCoachMessageContent("I found five qualified picks from the live board."),
    "I found five qualified picks from the live board.",
  );
});
