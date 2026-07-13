import { test } from "node:test";
import assert from "node:assert/strict";

import {
  emptyStealFeedDiagnostics,
  StealFeedScanError,
} from "../src/lib/stealFeedDiagnostics.ts";

test("StealFeedScanError carries structured diagnostics", () => {
  const diagnostics = emptyStealFeedDiagnostics({
    errorReason: "ODDS_API_KEY not configured",
    sportsProbed: 8,
    sportsFailed: 8,
  });
  const err = new StealFeedScanError("odds unreachable", diagnostics);
  assert.equal(err.diagnostics.errorReason, "ODDS_API_KEY not configured");
  assert.equal(err.diagnostics.sportsFailed, 8);
});
