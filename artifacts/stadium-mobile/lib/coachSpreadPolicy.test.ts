import assert from "node:assert/strict";
import test from "node:test";
import { coachLineHoldReason, coachTimeBudgetNote } from "./coachSpreadPolicy.ts";
import { applyDeliveryGroundingGate } from "./coachDeliveryGrounding.ts";
import { capGradeForConfidence } from "./finalAiScore.ts";

test("uncalibrated spreads are withheld even below the old limits and after staging", () => {
  for (const market of ["Puck Line", "Alt Spread", "Run Line", "1H Spread"]) {
    const pick = { market, sport: "nhl", simHit: 0.61, edgePct: 8.6, qualificationStatus: "qualified" };
    assert.equal(coachLineHoldReason(pick), "check_line");
  }
});

test("college legs need both a sportsbook and score breakdown", () => {
  const pick = { sport: "ncaaf", market: "Total", qualificationStatus: "qualified" as const };
  assert.equal(coachLineHoldReason({ ...pick, sportsbook: "Book" }), "college_evidence_missing");
  assert.equal(coachLineHoldReason({ ...pick, finalAiScore: { rubric: { composite: 7 } } }), "college_evidence_missing");
  assert.equal(coachLineHoldReason({
    ...pick, sportsbook: "Book", finalAiScore: { rubric: { composite: 7 } },
  }), null);
});

test("shared grade display caps any A-range grade with Medium confidence", () => {
  for (const grade of ["A-", "A", "A+"]) assert.equal(capGradeForConfidence(grade, "Medium"), "B");
  assert.equal(capGradeForConfidence("A+", "High"), "A+");
  assert.equal(capGradeForConfidence("C+", "Medium"), "C+");
});

test("market cap reports the specific family and the timeout states the count", () => {
  const rejected: string[] = [];
  const picks = Array.from({ length: 6 }, (_, i) => ({
    market: "Total", game: `Away ${i} @ Home ${i}`, pick: "Over 6.5",
  }));
  const result = applyDeliveryGroundingGate({
    picks, target: 15, enforceLongTicketLimits: true,
    onRejected: (_, reason) => rejected.push(reason),
  });
  assert.equal(result.picks.length, 5);
  assert.deepEqual(rejected, ["game_market_family_cap:total"]);
  assert.equal(coachTimeBudgetNote(5, 15), "Stopped at time budget. Returned 5 of 15 qualified legs.");
});
