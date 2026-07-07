import assert from "node:assert/strict";
import test from "node:test";

import { browseCoachMessage, browseSportsBundleReady, isStaleBundleCrashError } from "./browseSportsGuard.ts";

test("browseCoachMessage returns table tennis prompt", () => {
  const msg = browseCoachMessage("tabletennis");
  assert.ok(msg.toLowerCase().includes("table tennis"));
});

test("browseSportsBundleReady detects if/else guard implementation", () => {
  assert.equal(browseSportsBundleReady(), true);
  assert.ok(browseCoachMessage.toString().includes('sportId === "tabletennis"'));
});

test("isStaleBundleCrashError matches known stale OTA Hermes errors", () => {
  assert.equal(isStaleBundleCrashError("Property 'tabletennis' doesn't exist"), true);
  assert.equal(isStaleBundleCrashError("Cannot read property 'getOddsSelector' of undefined"), true);
  assert.equal(isStaleBundleCrashError("userFound is not a function"), true);
  assert.equal(isStaleBundleCrashError("Network request failed"), false);
});
