import assert from "node:assert/strict";
import test from "node:test";

import {
  formatBundleIdentityLine,
  getBundleIdentity,
  logBundleIdentity,
} from "./bundleIdentity.ts";

test("bundle identity exposes commit path and dev flag", () => {
  const id = getBundleIdentity();
  assert.ok(id.commit);
  assert.ok(id.projectPath.includes("stadium-mobile"));
  assert.ok(id.bundleTimestamp);
  assert.equal(typeof id.dev, "boolean");
  assert.ok(id.metroMode);
});

test("formatBundleIdentityLine shows dev-client mode and commit only", () => {
  const line = formatBundleIdentityLine("req-abc-12345");
  assert.match(line, /commit/);
  assert.match(line, /dev-client|production/);
  assert.doesNotMatch(line, /stadium-mobile/);
  assert.doesNotMatch(line, /req /);
});

test("logBundleIdentity is idempotent", () => {
  logBundleIdentity();
  logBundleIdentity();
});
