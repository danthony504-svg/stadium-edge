import assert from "node:assert/strict";
import test from "node:test";

import {
  APP_STORE_IOS_URL,
  EMBEDDED_MIN_IOS_VERSION,
  compareAppVersions,
  decideForceUpdate,
  isAppVersionBelow,
} from "./appVersion.ts";

test("1.0.3 is below 1.1.0", () => {
  assert.equal(compareAppVersions("1.0.3", "1.1.0"), -1);
  assert.equal(isAppVersionBelow("1.0.3", "1.1.0"), true);
  assert.equal(isAppVersionBelow("1.1.0", "1.1.0"), false);
});

test("server min version forces update for 1.0.3", () => {
  const d = decideForceUpdate({
    currentVersion: "1.0.3",
    serverMinIosVersion: "1.1.0",
    serverAppStoreUrl: APP_STORE_IOS_URL,
    serverMessage: "Please update",
    serverReachable: true,
  });
  assert.equal(d.required, true);
  assert.equal(d.minIosVersion, "1.1.0");
  assert.match(d.appStoreUrl, /id6776024127/);
});

test("1.1.0 remains functional when server requires 1.1.0", () => {
  const d = decideForceUpdate({
    currentVersion: "1.1.0",
    serverMinIosVersion: "1.1.0",
    serverReachable: true,
  });
  assert.equal(d.required, false);
});

test("offline fail-open for normal clients (do not brick 1.1.0)", () => {
  const d = decideForceUpdate({
    currentVersion: "1.1.0",
    serverReachable: false,
    preferEmbeddedFloor: false,
  });
  assert.equal(d.required, false);
});

test("offline with embedded floor blocks 1.0.3 (dedicated force-update OTA)", () => {
  assert.equal(EMBEDDED_MIN_IOS_VERSION, "1.1.0");
  const d = decideForceUpdate({
    currentVersion: "1.0.3",
    serverReachable: false,
    preferEmbeddedFloor: true,
  });
  assert.equal(d.required, true);
  assert.equal(d.minIosVersion, "1.1.0");
});

test("server failure with reachable=false and no floor leaves 1.0.3 unblocked", () => {
  // Without a 1.0.3 OTA that sets preferEmbeddedFloor, JS on 1.0.3 cannot
  // show this screen anyway — fail-open avoids false bricks on misconfig.
  const d = decideForceUpdate({
    currentVersion: "1.0.3",
    serverReachable: false,
    preferEmbeddedFloor: false,
  });
  assert.equal(d.required, false);
});
