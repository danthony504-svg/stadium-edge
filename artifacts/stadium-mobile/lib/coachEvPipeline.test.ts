import assert from "node:assert/strict";
import { test } from "node:test";

import {
  runCoachEvPropPrescore,
} from "./coachEvPipeline.ts";
import { beginCoachScanPipeline, clearCoachScanPipeline } from "./coachScanPipeline.ts";
import type { ParsedPick } from "../components/PickCard.tsx";

function propPick(player: string): ParsedPick {
  return {
    game: "A @ B",
    market: "Points",
    pick: `${player} Over 1.5 Points`,
    player,
    isProp: true,
    odds: -110,
    propSide: "Over",
    propLine: 1.5,
  };
}

test("runCoachEvPropPrescore completes with bounded concurrency", async () => {
  beginCoachScanPipeline("req-ev-1");
  const picks = [propPick("P1"), propPick("P2"), propPick("P3")];
  const result = await runCoachEvPropPrescore(picks, { propPool: [] }, { requestId: "req-ev-1" });
  assert.equal(result.inputCount, 3);
  assert.equal(result.scored.length, 3);
  assert.equal(result.propDurations.length, 3);
  clearCoachScanPipeline("req-ev-1");
});

test("runCoachEvPropPrescore skips a bad prop and continues", async () => {
  beginCoachScanPipeline("req-ev-2");
  const evil = propPick("Bad");
  Object.defineProperty(evil, "player", {
    get() {
      throw new Error("bad prop");
    },
  });
  const picks = [propPick("Good"), evil, propPick("AlsoGood")];
  const result = await runCoachEvPropPrescore(picks, { propPool: [] }, { requestId: "req-ev-2" });
  assert.equal(result.outputCount, 2);
  assert.ok(result.propDurations.some((d) => d.error === "bad prop"));
  clearCoachScanPipeline("req-ev-2");
});

test("runCoachEvPropPrescore continues with zero scored props", async () => {
  beginCoachScanPipeline("req-ev-3");
  const result = await runCoachEvPropPrescore([], { propPool: [] }, { requestId: "req-ev-3" });
  assert.equal(result.outputCount, 0);
  assert.equal(result.inputCount, 0);
  clearCoachScanPipeline("req-ev-3");
});

test("runCoachEvPropPrescore times out on slow prop scoring", async () => {
  beginCoachScanPipeline("req-ev-4");
  const slow = propPick("Slow");
  Object.defineProperty(slow, "game", {
    get() {
      const start = Date.now();
      while (Date.now() - start < 50) {
        /* burn CPU to exceed test timeout budget */
      }
      return "A @ B";
    },
  });
  const picks = Array.from({ length: 40 }, (_, i) => (i === 0 ? slow : propPick(`P${i}`)));
  const started = Date.now();
  const result = await runCoachEvPropPrescore(picks, { propPool: [] }, {
    requestId: "req-ev-4",
    timeoutMs: 30,
    target: 5,
  });
  assert.equal(result.timedOut, true);
  assert.ok(result.outputCount > 0);
  assert.equal(result.stats.processedCount < result.stats.inputCount, true);
  assert.ok(Date.now() - started < 2_000);
  clearCoachScanPipeline("req-ev-4");
});

test("runCoachEvPropPrescore resolves requestId from active pipeline", async () => {
  beginCoachScanPipeline("req-ev-active");
  const picks = [propPick("P1"), propPick("P2")];
  const result = await runCoachEvPropPrescore(picks, { propPool: [] }, {});
  assert.equal(result.outputCount, 2);
  clearCoachScanPipeline("req-ev-active");
});
