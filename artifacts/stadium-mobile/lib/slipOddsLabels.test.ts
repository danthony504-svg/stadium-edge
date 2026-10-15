/**
 * Lock slip copy: estimated combined odds + independence-based implied.
 * Not an estimated joint win probability.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("slip UI labels estimated combined odds and independence-based implied", () => {
  const slip = readFileSync(join(root, "app/(tabs)/slip.tsx"), "utf8");
  assert.match(slip, /Estimated combined odds/);
  assert.match(slip, /Independence-based implied probability/);
  assert.match(slip, /Actual sportsbook pricing may\s+differ, especially for same-game tickets/);
  assert.match(slip, /not an estimated joint chance of winning/i);
  assert.doesNotMatch(slip, /Implied win prob/);
  assert.doesNotMatch(slip, />\s*Combined odds\s*</);
  assert.doesNotMatch(slip, /Combined book implied/);
});
