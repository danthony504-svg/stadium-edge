import assert from "node:assert/strict";
import test from "node:test";

import { browseCoachMessage, browseSportsBundleReady } from "./browseSportsGuard.ts";

test("browseCoachMessage returns table tennis prompt", () => {
  const msg = browseCoachMessage("tabletennis");
  assert.ok(msg.toLowerCase().includes("table tennis"));
});

test("browseSportsBundleReady detects if/else guard implementation", () => {
  assert.equal(browseSportsBundleReady(), true);
  assert.ok(browseCoachMessage.toString().includes('sportId === "tabletennis"'));
});
