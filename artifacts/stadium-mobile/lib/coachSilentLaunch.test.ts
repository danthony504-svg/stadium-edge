import assert from "node:assert/strict";
import test from "node:test";

import {
  clearCoachHomeLaunch,
  coachIdleNavParams,
  markCoachHomeLaunch,
  takeCoachLaunch,
} from "./coachSilentLaunch.ts";

test("coachIdleNavParams clears auto-send keys and marks idle navigation", () => {
  const params = coachIdleNavParams();
  assert.equal(params.nav, "idle");
  assert.equal(params.send, "");
  assert.equal(params.autoMsg, "");
  assert.equal(params.prefill, "");
  assert.ok(params.ts);
});

test("clearCoachHomeLaunch drops pending Home one-tap launch opts", () => {
  markCoachHomeLaunch();
  assert.ok(takeCoachLaunch());
  markCoachHomeLaunch();
  clearCoachHomeLaunch();
  assert.equal(takeCoachLaunch(), null);
});

test("idle nav params do not satisfy auto-send gate", () => {
  const params = coachIdleNavParams();
  const sendFlag = params.send;
  const autoMsg = params.autoMsg;
  assert.notEqual(sendFlag, "1");
  assert.equal(autoMsg, "");
});
