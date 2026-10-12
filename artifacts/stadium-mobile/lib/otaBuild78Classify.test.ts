import assert from "node:assert/strict";
import { test } from "node:test";

import {
  EXPECTED_RUNTIME_VERSION,
  EXPECTED_UPDATE_ID,
  classifyBuild78Ota,
  productionTipMarkerExpectations,
} from "./otaBuild78Classify.ts";

test("A — tip updateId + not embedded", () => {
  const r = classifyBuild78Ota({
    runtimeVersion: EXPECTED_RUNTIME_VERSION,
    updateId: EXPECTED_UPDATE_ID,
    isEmbeddedLaunch: false,
    channel: "production",
  });
  assert.equal(r.classId, "A");
  assert.equal(r.matchesExpectedUpdateId, true);
  assert.equal(r.tipMarkersExpectedIfClassA.qualityFloorFrom709, false);
  assert.equal(r.tipMarkersExpectedIfClassA.slipUiEnabled, false);
});

test("B — runtime 1.1.0 with stale updateId", () => {
  const r = classifyBuild78Ota({
    runtimeVersion: "1.1.0",
    updateId: "00000000-1111-2222-3333-444444444444",
    isEmbeddedLaunch: false,
  });
  assert.equal(r.classId, "B");
});

test("C — embedded Build 78 without probe errors", () => {
  const r = classifyBuild78Ota({
    runtimeVersion: "1.1.0",
    updateId: "embedded",
    isEmbeddedLaunch: true,
  });
  assert.equal(r.classId, "C");
});

test("D — embedded with check error", () => {
  const r = classifyBuild78Ota({
    runtimeVersion: "1.1.0",
    updateId: "embedded",
    isEmbeddedLaunch: true,
    checkResult: "ERR: network request failed",
  });
  assert.equal(r.classId, "D");
});

test("D — tip id but embedded still true", () => {
  const r = classifyBuild78Ota({
    runtimeVersion: "1.1.0",
    updateId: EXPECTED_UPDATE_ID,
    isEmbeddedLaunch: true,
  });
  assert.equal(r.classId, "D");
});

test("E — legacy runtime", () => {
  const r = classifyBuild78Ota({
    runtimeVersion: "1.0.3",
    updateId: "anything",
    isEmbeddedLaunch: false,
  });
  assert.equal(r.classId, "E");
});

test("production tip marker expectations document unpublished #709", () => {
  const m = productionTipMarkerExpectations();
  assert.equal(m.updateId, EXPECTED_UPDATE_ID);
  assert.equal(m.qualityFloorFrom709, false);
  assert.equal(m.slipUiEnabled, false);
  assert.equal(m.greenfieldBuildCoachParlay, true);
});
