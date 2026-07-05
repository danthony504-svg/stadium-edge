import assert from "node:assert/strict";
import test from "node:test";
import {
  confidenceTierLabel,
  expectedValuePer100,
  fairOddsFromProb,
  fairProbFromEdge,
  formatSimHitCount,
  buildPickReasons,
} from "./simulatorBetDisplay.ts";

test("formatSimHitCount shows raw wins out of simulations", () => {
  assert.equal(formatSimHitCount(0.7164, 10_000), "7,164/10,000");
  assert.equal(formatSimHitCount(null, 10_000), null);
});

test("fairOddsFromProb converts probability to American odds", () => {
  const fair = fairOddsFromProb(0.55);
  assert.match(fair, /^[+-]\d+$/);
});

test("fairProbFromEdge derives fair probability from edge", () => {
  const fair = fairProbFromEdge(-110, 3);
  assert.ok(fair != null && fair > 0.5);
});

test("expectedValuePer100 is positive when sim hit beats implied odds", () => {
  const ev = expectedValuePer100(0.58, -110);
  assert.ok(ev != null && ev > 0);
});

test("confidenceTierLabel maps profiles to Elite/High/Medium/Risky/Longshot", () => {
  assert.equal(
    confidenceTierLabel({ composite: 8.5, confidencePct: 80, simHit: 0.58, odds: -110 }),
    "Elite",
  );
  assert.equal(confidenceTierLabel({ odds: 600, simHit: 0.3 }), "Longshot");
  assert.equal(confidenceTierLabel({ highRiskValuePlay: true, composite: 5 }), "Risky");
});

test("buildPickReasons returns up to five grounded bullets", () => {
  const reasons = buildPickReasons(
    {
      composite: 8,
      grade: "A-",
      confidencePct: 70,
      edgePct: 2.5,
      simHit: 0.57,
      simAligned: true,
      highRiskValuePlay: false,
      recommends: true,
      factors: [
        { key: "matchup", label: "Matchup", score: 7.5 },
        { key: "trend", label: "Recent Form", score: 7.2 },
      ],
      rubric: { scores: {}, composite: 8, grade: "A-", confidencePct: 70, edgePct: 2.5 },
    },
    { simulations: 10_000, fairProb: 0.54, odds: -110 },
  );
  assert.ok(reasons.length >= 3 && reasons.length <= 5);
  assert.ok(reasons.some((r) => r.includes("7,164/10,000") || r.includes("10,000")));
});
