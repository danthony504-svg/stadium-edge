import assert from "node:assert/strict";
import test from "node:test";
import {
  consumeCoachLaunch,
  markCoachHomeLaunch,
  peekCoachLaunch,
  queueCoachAutoSend,
  takeCoachLaunch,
} from "./coachSilentLaunch.ts";

test("markCoachHomeLaunch stashes autoMsg for tab param fallback", () => {
  markCoachHomeLaunch("Build me the best parlay");
  const launch = peekCoachLaunch();
  assert.equal(launch?.autoMsg, "Build me the best parlay");
  assert.equal(launch?.hideBubble, true);
  assert.equal(launch?.freshThread, true);
  consumeCoachLaunch();
  assert.equal(peekCoachLaunch(), null);
});

test("consumeCoachLaunch clears stale queue so prefill-only navigation does not auto-send", () => {
  queueCoachAutoSend("Build me the best parlay", { hideBubble: true, freshThread: true });
  consumeCoachLaunch();
  assert.equal(peekCoachLaunch(), null);
});

test("queueCoachAutoSend can show the user bubble", () => {
  queueCoachAutoSend("Build me a safe parlay", { hideBubble: false, freshThread: false });
  const launch = takeCoachLaunch();
  assert.equal(launch?.autoMsg, "Build me a safe parlay");
  assert.equal(launch?.hideBubble, false);
});
