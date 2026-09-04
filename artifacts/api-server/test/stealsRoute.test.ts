import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { emptyStealFeedDiagnostics } from "../src/lib/stealFeedDiagnostics.ts";

test("live-steals route source never returns HTTP 502", () => {
  const routePath = fileURLToPath(new URL("../src/routes/steals.ts", import.meta.url));
  const source = readFileSync(routePath, "utf8");
  assert.equal(source.includes("status(502)"), false);
  assert.equal(source.includes("could not load steals"), false);
  assert.ok(source.includes("feedDegraded"));
  assert.ok(source.includes("scanComplete: false"));
  assert.ok(source.includes("scanError"));
  assert.ok(source.includes("live-steals scan failed"));
});

test("degraded feed diagnostics always include scan endpoint metadata", () => {
  const feed = emptyStealFeedDiagnostics({
    errorReason: "all_sports_odds_unreachable",
    responseTimeMs: 42,
  });
  assert.equal(feed.scanEndpoint, "/api/sports/live-steals");
  assert.equal(feed.provider, "the-odds-api");
  assert.equal(feed.errorReason, "all_sports_odds_unreachable");
  assert.equal(feed.responseTimeMs, 42);
});
