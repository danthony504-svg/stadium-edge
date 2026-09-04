import assert from "node:assert/strict";
import { test } from "node:test";

import {
  capCoachEvCandidates,
  coachEvPoolCap,
  coachEvQualifiedStopCount,
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

test("coachEvPoolCap scales with leg target", () => {
  assert.equal(coachEvPoolCap(5, 500), 80);
  assert.equal(coachEvPoolCap(5, 40), 40);
  assert.equal(coachEvQualifiedStopCount(5), 20);
});

test("capCoachEvCandidates limits pool before scoring", () => {
  const picks = Array.from({ length: 200 }, (_, i) => propPick(`P${i}`));
  const { capped, poolCap } = capCoachEvCandidates(picks, 5);
  assert.equal(poolCap, 80);
  assert.equal(capped.length, 80);
});

test("runCoachEvPropPrescore soft-timeout returns partial results", async () => {
  beginCoachScanPipeline("req-ev-soft");
  const slow = propPick("Slow");
  Object.defineProperty(slow, "game", {
    get() {
      const start = Date.now();
      while (Date.now() - start < 50) {
        /* burn CPU */
      }
      return "A @ B";
    },
  });
  const picks = Array.from({ length: 40 }, (_, i) => (i === 0 ? slow : propPick(`P${i}`)));
  const result = await runCoachEvPropPrescore(picks, { propPool: [] }, {
    requestId: "req-ev-soft",
    timeoutMs: 30,
    target: 5,
  });
  assert.equal(result.timedOut, true);
  assert.ok(result.outputCount > 0);
  assert.ok(result.stats.processedCount > 0);
  assert.ok(result.stats.batchNumber > 0);
  clearCoachScanPipeline("req-ev-soft");
});
