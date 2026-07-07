import assert from "node:assert/strict";
import test from "node:test";

import { browseCoachMessage, browseSportsBundleReady } from "./browseSportsGuard.ts";

test("browseCoachMessage returns table tennis prompt", () => {
  const msg = browseCoachMessage("tabletennis");
  assert.ok(msg.toLowerCase().includes("table tennis"));
});

test("browseSportsBundleReady is true in current bundle", () => {
  assert.equal(browseSportsBundleReady(), true);
});
