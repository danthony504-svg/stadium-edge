import assert from "node:assert/strict";
import { test } from "node:test";

import type { ParsedPick } from "../components/PickCard.tsx";
import {
  armCoachBuildFinalizeWatchdog,
  coachBuildWasFinalized,
  COACH_BUILD_FINALIZE_WATCHDOG_MS,
  disarmCoachBuildFinalizeWatchdog,
  finalizeCoachBuild,
  getLatestCoachFinalizeResult,
  markCoachBuildFinalized,
  resetCoachBuildFinalization,
  shouldTerminateCoachBuildOnDeliveryGateFailure,
} from "./coachBuildFinalization.ts";

const stubPick = { player: "Test", game: "A @ B" } as ParsedPick;

test("shouldTerminateCoachBuildOnDeliveryGateFailure only on final scan", () => {
  assert.equal(shouldTerminateCoachBuildOnDeliveryGateFailure(true, false), true);
  assert.equal(shouldTerminateCoachBuildOnDeliveryGateFailure(false, false), false);
  assert.equal(shouldTerminateCoachBuildOnDeliveryGateFailure(true, true), false);
});

test("coach build finalization is idempotent per request", () => {
  resetCoachBuildFinalization();
  assert.equal(coachBuildWasFinalized(1, "req-a"), false);
  markCoachBuildFinalized(1, "req-a");
  assert.equal(coachBuildWasFinalized(1, "req-a"), true);
  assert.equal(coachBuildWasFinalized(2, "req-a"), false);
  resetCoachBuildFinalization();
  assert.equal(coachBuildWasFinalized(1, "req-a"), false);
});

test("finalizeCoachBuild runs commit once and stores latest result", () => {
  resetCoachBuildFinalization();
  let commits = 0;
  const result = {
    requestId: "req-final",
    sendGeneration: 7,
    picks: [stubPick],
    correlationComplete: true,
  };
  assert.equal(finalizeCoachBuild(result, () => {
    commits += 1;
  }), true);
  assert.equal(commits, 1);
  assert.equal(getLatestCoachFinalizeResult("req-final")?.picks.length, 1);
  assert.equal(finalizeCoachBuild(result, () => {
    commits += 1;
  }), true);
  assert.equal(commits, 1);
});

test("finalize watchdog fires once after 3 seconds", async () => {
  resetCoachBuildFinalization();
  let fires = 0;
  armCoachBuildFinalizeWatchdog(3, "req-b", () => {
    fires += 1;
    markCoachBuildFinalized(3, "req-b");
  });
  await new Promise((r) => setTimeout(r, COACH_BUILD_FINALIZE_WATCHDOG_MS - 50));
  assert.equal(fires, 0);
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(fires, 1);
  armCoachBuildFinalizeWatchdog(3, "req-b", () => {
    fires += 1;
  });
  await new Promise((r) => setTimeout(r, COACH_BUILD_FINALIZE_WATCHDOG_MS + 50));
  assert.equal(fires, 1);
  disarmCoachBuildFinalizeWatchdog();
});

test("finalize watchdog does not fire after request is marked finalized", async () => {
  resetCoachBuildFinalization();
  let fires = 0;
  armCoachBuildFinalizeWatchdog(4, "req-c", () => {
    fires += 1;
  });
  markCoachBuildFinalized(4, "req-c");
  await new Promise((r) => setTimeout(r, COACH_BUILD_FINALIZE_WATCHDOG_MS + 50));
  assert.equal(fires, 0);
  disarmCoachBuildFinalizeWatchdog();
});

test("five-leg build finalizes three times without duplicate commits", () => {
  resetCoachBuildFinalization();
  for (let run = 1; run <= 3; run += 1) {
    const requestId = `five-leg-${run}`;
    const sendGeneration = run;
    let commits = 0;
    const picks = Array.from({ length: 5 }, (_, i) => ({
      ...stubPick,
      player: `Leg ${i + 1}`,
    })) as ParsedPick[];

    const commitTerminal = () => {
      commits += 1;
    };

    finalizeCoachBuild(
      {
        requestId,
        sendGeneration,
        picks,
        correlationComplete: true,
      },
      commitTerminal,
    );
    assert.equal(commits, 1, `run ${run}: first finalize must commit`);
    assert.equal(coachBuildWasFinalized(sendGeneration, requestId), true);

    finalizeCoachBuild(
      {
        requestId,
        sendGeneration,
        picks,
        correlationComplete: true,
        fallbackUsed: true,
      },
      commitTerminal,
    );
    assert.equal(commits, 1, `run ${run}: duplicate finalize must not commit again`);

    resetCoachBuildFinalization();
  }
});
