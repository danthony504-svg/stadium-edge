import assert from "node:assert/strict";
import test from "node:test";

import {
  beginCoachSimulateSession,
  CoachSimulateLimiter,
  endCoachSimulateSession,
  resetCoachSimulateSessionForTests,
} from "./coachSimulateLimiter.ts";

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

test.afterEach(() => {
  resetCoachSimulateSessionForTests();
});

test("prop waiters drain before game waiters under shared limiter pressure", async () => {
  const lim = new CoachSimulateLimiter(1);
  const order: string[] = [];

  const hold = lim.run("prop", async () => {
    order.push("prop-hold-start");
    await delay(40);
    order.push("prop-hold-end");
  });

  // Queue game then prop while slot is held — prop must run next.
  const gameP = lim.run("game", async () => {
    order.push("game");
  });
  await delay(5);
  const propP = lim.run("prop", async () => {
    order.push("prop-queued");
  });

  await Promise.all([hold, gameP, propP]);
  assert.deepEqual(order, ["prop-hold-start", "prop-hold-end", "prop-queued", "game"]);
  assert.ok(lim.getGameQueueWaitMs() >= lim.getPropQueueWaitMs() || lim.getGameQueueWaitMs() > 0);
  assert.equal(lim.inFlightPeak, 1);
});

test("in-flight peak never exceeds maxInFlight", async () => {
  const lim = new CoachSimulateLimiter(2);
  await Promise.all(
    Array.from({ length: 6 }, (_, i) =>
      lim.run(i % 2 === 0 ? "prop" : "game", async () => {
        await delay(20);
      }),
    ),
  );
  assert.ok(lim.inFlightPeak <= 2);
  assert.equal(lim.inFlightCount, 0);
});

test("session overlap metrics capture prop∥game window", () => {
  const session = beginCoachSimulateSession({ now: 1_000 });
  session.markPropPhaseStart(1_000);
  session.markGamePhaseStart(1_010);
  session.markGamePhaseEnd(1_050);
  session.markPropPhaseEnd(1_080);
  session.markFinalizationStart(1_080);
  session.markFinalizationEnd(1_090);
  const m = endCoachSimulateSession();
  assert.ok(m);
  assert.equal(m!.propPhaseStartMs, 0);
  assert.equal(m!.gamePhaseStartMs, 10);
  assert.equal(m!.overlapMs, 40);
  assert.equal(m!.finalizationStartMs, 80);
  assert.equal(m!.finalizationEndMs, 90);
  assert.equal(m!.totalScoringWallMs, 90);
});
