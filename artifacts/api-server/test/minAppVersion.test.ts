import assert from "node:assert/strict";
import test from "node:test";

import {
  APP_STORE_IOS_URL,
  DEFAULT_MIN_IOS_VERSION,
  buildAppConfigPayload,
  compareAppVersions,
  isAppVersionBelow,
  isMinIosVersionEnforcementEnabled,
  isMinVersionExemptPath,
} from "../src/lib/minAppVersion.ts";

test("compareAppVersions orders 1.0.3 below 1.1.0", () => {
  assert.equal(compareAppVersions("1.0.3", "1.1.0"), -1);
  assert.equal(compareAppVersions("1.1.0", "1.0.3"), 1);
  assert.equal(compareAppVersions("1.1.0", "1.1.0"), 0);
  assert.equal(compareAppVersions("1.1.0", "1.1"), 0);
  assert.equal(compareAppVersions("v1.0.3", "1.1.0"), -1);
});

test("isAppVersionBelow", () => {
  assert.equal(isAppVersionBelow("1.0.3", "1.1.0"), true);
  assert.equal(isAppVersionBelow("1.1.0", "1.1.0"), false);
  assert.equal(isAppVersionBelow("1.2.0", "1.1.0"), false);
  assert.equal(isAppVersionBelow("", "1.1.0"), false);
});

test("default min iOS version is 1.1.0 and App Store id is correct", () => {
  assert.equal(DEFAULT_MIN_IOS_VERSION, "1.1.0");
  assert.match(APP_STORE_IOS_URL, /id6776024127/);
  const cfg = buildAppConfigPayload();
  assert.equal(cfg.minIosVersion, "1.1.0");
  assert.match(cfg.appStoreUrl, /id6776024127/);
  assert.match(cfg.updateRequiredMessage, /1\.1\.0/);
});

test("exempt paths include health, app config, subscriptions, app-review auth", () => {
  assert.equal(isMinVersionExemptPath("/healthz"), true);
  assert.equal(isMinVersionExemptPath("/app/config"), true);
  assert.equal(isMinVersionExemptPath("/subscriptions/sync"), true);
  assert.equal(isMinVersionExemptPath("/subscriptions/webhooks/revenuecat"), true);
  assert.equal(isMinVersionExemptPath("/auth/app-review-ticket"), true);
  assert.equal(isMinVersionExemptPath("/odds?sport=nba"), false);
  assert.equal(isMinVersionExemptPath("/chat"), false);
});

test("426 enforcement is disabled unless MIN_IOS_VERSION_ENFORCEMENT=true", () => {
  const prev = process.env.MIN_IOS_VERSION_ENFORCEMENT;
  delete process.env.MIN_IOS_VERSION_ENFORCEMENT;
  assert.equal(isMinIosVersionEnforcementEnabled(), false);
  process.env.MIN_IOS_VERSION_ENFORCEMENT = "true";
  assert.equal(isMinIosVersionEnforcementEnabled(), true);
  process.env.MIN_IOS_VERSION_ENFORCEMENT = "false";
  assert.equal(isMinIosVersionEnforcementEnabled(), false);
  if (prev == null) delete process.env.MIN_IOS_VERSION_ENFORCEMENT;
  else process.env.MIN_IOS_VERSION_ENFORCEMENT = prev;
});
