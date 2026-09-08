import assert from "node:assert/strict";
import test from "node:test";
import {
  coachLifecycleBoardScanEnd,
  coachLifecycleBoardScanStart,
  coachLifecycleBuildComplete,
  coachLifecycleCardsCommitted,
  coachLifecycleDeliveryComplete,
  coachLifecycleExpectedOrder,
  coachLifecycleIsBuildComplete,
  coachLifecycleRequestStart,
} from "./coachParlayLifecycle.ts";

test("coach lifecycle emits ordered events ending with build-complete", () => {
  const events: string[] = [];
  const orig = console.log;
  console.log = (msg?: unknown) => {
    if (typeof msg === "string" && msg.includes("[coach-lifecycle]")) {
      const event = msg.replace("[coach-lifecycle] ", "").split(" ")[0];
      events.push(event!);
    }
  };
  try {
    coachLifecycleRequestStart("req-1");
    coachLifecycleBoardScanStart("req-1");
    coachLifecycleBoardScanEnd({ scanComplete: true }, "req-1");
    coachLifecycleDeliveryComplete("req-1");
    coachLifecycleCardsCommitted("req-1");
    coachLifecycleBuildComplete("req-1");
    assert.deepEqual(events, coachLifecycleExpectedOrder());
    assert.equal(coachLifecycleIsBuildComplete(), true);
    coachLifecycleBuildComplete("req-1");
    assert.equal(events.filter((e) => e === "build-complete").length, 1);
  } finally {
    console.log = orig;
  }
});

test("lifecycle delivery and cards events dedupe", () => {
  const events: string[] = [];
  const orig = console.log;
  console.log = (msg?: unknown) => {
    if (typeof msg === "string" && msg.includes("[coach-lifecycle]")) {
      const event = msg.replace("[coach-lifecycle] ", "").split(" ")[0];
      events.push(event!);
    }
  };
  try {
    coachLifecycleRequestStart("req-3");
    coachLifecycleDeliveryComplete("req-3");
    coachLifecycleDeliveryComplete("req-3");
    coachLifecycleCardsCommitted("req-3");
    coachLifecycleCardsCommitted("req-3");
    assert.equal(events.filter((e) => e === "delivery-complete").length, 1);
    assert.equal(events.filter((e) => e === "cards-committed").length, 1);
  } finally {
    console.log = orig;
  }
});

test("lifecycle simulates 5-leg and 15-leg request starts", () => {
  for (const legs of [5, 15]) {
    coachLifecycleRequestStart(`req-${legs}`);
    coachLifecycleBoardScanStart(`req-${legs}`);
    coachLifecycleBoardScanEnd({ scanComplete: true }, `req-${legs}`);
    coachLifecycleDeliveryComplete(`req-${legs}`);
    coachLifecycleCardsCommitted(`req-${legs}`);
    coachLifecycleBuildComplete(`req-${legs}`);
    assert.equal(coachLifecycleIsBuildComplete(), true);
  }
});

test("lifecycle supports consecutive requests", () => {
  for (let i = 0; i < 3; i++) {
    coachLifecycleRequestStart(`req-seq-${i}`);
    coachLifecycleBuildComplete(`req-seq-${i}`);
    assert.equal(coachLifecycleIsBuildComplete(), true);
  }
});

test("partial board scan does not emit scoring or correlation complete", () => {
  const events: string[] = [];
  const orig = console.log;
  console.log = (msg?: unknown) => {
    if (typeof msg === "string" && msg.includes("[coach-lifecycle]")) {
      const event = msg.replace("[coach-lifecycle] ", "").split(" ")[0];
      events.push(event!);
    }
  };
  try {
    coachLifecycleRequestStart("req-2");
    coachLifecycleBoardScanStart("req-2");
    coachLifecycleBoardScanEnd({ scanComplete: false }, "req-2");
    assert.deepEqual(events, ["request-start", "board-scan-start"]);
  } finally {
    console.log = orig;
  }
});
