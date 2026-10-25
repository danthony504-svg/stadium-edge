import assert from "node:assert/strict";
import test from "node:test";
import { coachDigestCoverage } from "../src/lib/coachDigestCoverage.ts";
test("incident: anonymous start does not hide nine requests or exclude timeouts", () => {
  const rows = [
    "parlay_fulfilled",
    "parlay_fulfilled",
    "parlay_fulfilled",
    "parlay_fulfilled",
    "parlay_underfilled",
    "parlay_underfilled",
    "coach_scan_freeze",
    "coach_scan_freeze",
    "coach_cancelled",
  ].map((eventType, i) => ({
    eventType,
    requestId: `r-${i}`,
    occurrenceCount: 1,
  }));
  assert.deepEqual(
    coachDigestCoverage([
      ...rows,
      {
        eventType: "coach_question_received",
        requestId: null,
        occurrenceCount: 1,
      },
    ]),
    {
      totalRequests: 9,
      requestStartEvents: 1,
      unidentifiedEvents: 1,
      cancelledEvents: 1,
      observedParlayTerminals: 8,
      fulfillmentPct: 50,
    },
  );
});
test("start and repeated terminal count once", () => {
  const r = coachDigestCoverage(
    ["parlay_requested", "parlay_fulfilled", "parlay_fulfilled"].map(
      (eventType) => ({ eventType, requestId: "same" }),
    ),
  );
  assert.equal(r.totalRequests, 1);
  assert.equal(r.observedParlayTerminals, 1);
  assert.equal(r.fulfillmentPct, 100);
});
test("legacy folded and contradictory records cannot manufacture a rate", () => {
  assert.equal(
    coachDigestCoverage([
      { eventType: "parlay_fulfilled", requestId: "last", occurrenceCount: 4 },
    ]).fulfillmentPct,
    null,
  );
  assert.equal(
    coachDigestCoverage([
      { eventType: "parlay_fulfilled", requestId: "x" },
      { eventType: "coach_scan_freeze", requestId: "x" },
    ]).fulfillmentPct,
    null,
  );
});
