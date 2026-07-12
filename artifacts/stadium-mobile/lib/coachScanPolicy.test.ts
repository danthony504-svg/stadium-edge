import test from "node:test";
import assert from "node:assert/strict";
import {
  COACH_FIXED_LEG_SHORTFALL_LEAD,
  FILLER_BACKFILL_EDGE_NOTE,
  isFillerBackfillPick,
  isFixedLegCountParlay,
  shouldAllowReachCountBackfill,
  shouldBlockUngradedParlayTopUp,
  shouldPromoteQualifyingAltsForFixedLegTicket,
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

test("isFixedLegCountParlay treats 3+ legs as fixed-leg asks", () => {
  assert.equal(isFixedLegCountParlay(2), false);
  assert.equal(isFixedLegCountParlay(3), true);
  assert.equal(isFixedLegCountParlay(15), true);
});

test("shouldPromoteQualifyingAltsForFixedLegTicket gates fixed-leg parlay builds", () => {
  assert.equal(
    shouldPromoteQualifyingAltsForFixedLegTicket({
      requestedLegs: 5,
      isParlayBuild: true,
    }),
    true,
  );
  assert.equal(
    shouldPromoteQualifyingAltsForFixedLegTicket({
      requestedLegs: 5,
      isParlayBuild: false,
    }),
    false,
  );
  assert.equal(
    shouldPromoteQualifyingAltsForFixedLegTicket({
      requestedLegs: 5,
      isParlayBuild: true,
      isAnalyze: true,
    }),
    false,
  );
  assert.equal(
    shouldPromoteQualifyingAltsForFixedLegTicket({
      requestedLegs: 5,
      isParlayBuild: true,
      altSign: "plus",
    }),
    false,
  );
  assert.equal(
    shouldPromoteQualifyingAltsForFixedLegTicket({
      requestedLegs: 2,
      isParlayBuild: true,
    }),
    false,
  );
});

test("COACH_FIXED_LEG_SHORTFALL_LEAD states honest shortfall copy", () => {
  assert.match(COACH_FIXED_LEG_SHORTFALL_LEAD, /Every qualifying market/i);
  assert.match(COACH_FIXED_LEG_SHORTFALL_LEAD, /AI-backed picks/i);
});

test("shouldBlockUngradedParlayTopUp blocks fixed-leg and board-scan parlays", () => {
  assert.equal(
    shouldBlockUngradedParlayTopUp({
      promoteQualifyingAlts: true,
    }),
    true,
  );
  assert.equal(
    shouldBlockUngradedParlayTopUp({
      fullBoardScanned: true,
    }),
    true,
  );
  assert.equal(
    shouldBlockUngradedParlayTopUp({
      reachBoardEligible: true,
    }),
    true,
  );
  assert.equal(shouldBlockUngradedParlayTopUp({}), false);
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
