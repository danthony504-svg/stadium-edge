import test from "node:test";
import assert from "node:assert/strict";
import type { ParsedPick } from "./parsedPick.ts";
import {
  detectCoachTicketStyle,
  legQualifiesAtMinGrade,
  qualityTiersForStyle,
} from "./coachTicketQualityTiers.ts";

test("detectCoachTicketStyle maps user phrasing to ticket styles", () => {
  assert.equal(detectCoachTicketStyle("build me a safe 4-leg parlay"), "safe");
  assert.equal(detectCoachTicketStyle("give me value underdogs"), "value");
  assert.equal(detectCoachTicketStyle("longshot lottery ticket"), "longshot");
  assert.equal(detectCoachTicketStyle("4 leg parlay for tonight"), "balanced");
});

test("qualityTiersForStyle stops at B+ for safe tickets", () => {
  assert.deepEqual(qualityTiersForStyle("safe"), ["A+", "A", "A-", "B+"]);
  assert.deepEqual(qualityTiersForStyle("balanced"), ["A+", "A", "A-", "B+", "B"]);
});

test("legQualifiesAtMinGrade accepts sim-aligned B-grade game lines at B tier", () => {
  const pick = {
    game: "C @ D",
    market: "Total",
    pick: "Over 8.5",
    odds: -110,
    isProp: false,
    sport: "mlb",
  } satisfies Partial<ParsedPick> as ParsedPick;
  const score = {
    composite: 6,
    grade: "B",
    confidencePct: 55,
    edgePct: 2,
    simHit: 0.56,
    simAligned: true,
    highRiskValuePlay: false,
    recommends: false,
    factors: [],
    rubric: { composite: 6, grade: "B", confidencePct: 55, edgePct: 2, scores: {} as never },
  };
  assert.equal(legQualifiesAtMinGrade(pick, score, "B"), true);
  assert.equal(legQualifiesAtMinGrade(pick, score, "B+"), false);
});
