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
  const pick = { sport: "ncaaf", market: "Moneyline", qualificationStatus: "qualified" as const };
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


test("the reported extreme puck-line and college spread probabilities remain withheld", () => {
  const nhl = { sport: "nhl", market: "Puck Line", simHit: 0.966, edgePct: 43.8 };
  const college = { sport: "ncaaf", market: "Alt Spread", simHit: 0.98, edgePct: 47 };
  assert.equal(coachLineHoldReason(nhl), "check_line");
  assert.equal(coachLineHoldReason(college), "check_line");
});

test("the spread exposure belt and imminent-start cutoff apply together", () => {
  const rejected: string[] = [];
  const picks = Array.from({ length: 7 }, (_, i) => ({
    market: "Puck Line", game: `Away ${i} @ Home ${i}`, pick: "Away +1.5",
    startsAt: new Date(Date.now() + (i === 0 ? 5 : 60) * 60_000).toISOString(),
  }));
  const result = applyDeliveryGroundingGate({
    picks, target: 15, enforceLongTicketLimits: true,
    onRejected: (_, reason) => rejected.push(reason),
  });
  assert.equal(result.picks.length, 5);
  assert.deepEqual(rejected, ["game_start_within_30_minutes", "game_market_family_cap:spread"]);
});

test("Coach holds game and team totals while preserving player overs and unders", () => {
  const extreme = { sport: "ncaaf", edgePct: 46.4, simHit: 0.98 };
  for (const market of ["Total", "Alt Total", "1H Total", "Team Total", "Over/Under"]) {
    assert.equal(coachLineHoldReason({ ...extreme, market }), "check_line");
  }
  assert.equal(coachLineHoldReason({ market: "Total", sport: "nba", isProp: true }), null);
});
