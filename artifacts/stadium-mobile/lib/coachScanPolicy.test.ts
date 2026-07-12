import test from "node:test";
import assert from "node:assert/strict";
import {
  FILLER_BACKFILL_EDGE_NOTE,
  isFillerBackfillPick,
  shouldAllowReachCountBackfill,
  stripFillerBackfillPicks,
} from "./coachScanPolicy.ts";

test("shouldAllowReachCountBackfill blocks 3+ leg board-scan parlays", () => {
  assert.equal(
    shouldAllowReachCountBackfill({
      isParlayBuild: true,
      legTarget: 5,
      reachBoardEligible: true,
    }),
    false,
  );
  assert.equal(
    shouldAllowReachCountBackfill({
      isParlayBuild: true,
      legTarget: 5,
      fullBoardScanned: true,
    }),
    false,
  );
  assert.equal(
    shouldAllowReachCountBackfill({
      isParlayBuild: true,
      legTarget: 2,
      reachBoardEligible: false,
    }),
    true,
  );
});

test("stripFillerBackfillPicks removes round-out posted lines", () => {
  const picks = [
    { game: "A @ B", market: "Moneyline", pick: "A ML", odds: 120 },
    {
      game: "C @ D",
      market: "Alt Spread",
      pick: "C -1",
      odds: 167,
      edge: FILLER_BACKFILL_EDGE_NOTE,
    },
  ];
  const out = stripFillerBackfillPicks(picks);
  assert.equal(out.length, 1);
  assert.equal(isFillerBackfillPick(picks[1]!), true);
});
