import assert from "node:assert/strict";
import test from "node:test";
import { UNIVERSAL_AI_RULES, UNIVERSAL_MIN_CONFIDENCE, UNIVERSAL_MIN_GRADE } from "./coachUniversalRules.ts";
import { evalCatalogForSport, headlineEvalFactors } from "./sportEvaluationFactors.ts";
import { pickHasLineMarketSignal } from "./coachLineSignal.ts";
import type { ParsedPick } from "../components/PickCard.tsx";

test("universal rules require C+ and confidence 52", () => {
  assert.equal(UNIVERSAL_MIN_GRADE, "C+");
  assert.equal(UNIVERSAL_MIN_CONFIDENCE, 52);
  assert.ok(UNIVERSAL_AI_RULES.some((r) => r.includes("positive EV")));
  assert.ok(UNIVERSAL_AI_RULES.some((r) => r.includes("C+")));
});

test("evalCatalogForSport resolves soccer and tennis", () => {
  assert.equal(evalCatalogForSport("soccer")?.label, "Soccer / World Cup");
  assert.equal(evalCatalogForSport("tennis")?.propFactors.length, 6);
  assert.ok(headlineEvalFactors("wnba").some((f) => /Minutes/i.test(f)));
});

test("pickHasLineMarketSignal accepts strong edge without book feed", () => {
  const pick: ParsedPick = {
    game: "A @ B",
    market: "Hits",
    pick: "Over 1.5",
    odds: -110,
    isProp: true,
    finalAiScore: {
      composite: 7,
      grade: "B",
      confidencePct: 65,
      edgePct: 3.2,
      simHit: 0.55,
      simAligned: true,
      highRiskValuePlay: false,
      recommends: true,
      factors: [],
      rubric: { scores: {}, composite: 7, grade: "B", confidencePct: 65, edgePct: 3.2 },
    },
  };
  assert.equal(pickHasLineMarketSignal(pick), true);
});

test("pickHasLineMarketSignal rejects thin edge without shopping signal", () => {
  const pick: ParsedPick = {
    game: "A @ B",
    market: "Hits",
    pick: "Over 1.5",
    odds: -110,
    isProp: true,
    finalAiScore: {
      composite: 6,
      grade: "C+",
      confidencePct: 60,
      edgePct: 1.1,
      simHit: 0.54,
      simAligned: true,
      highRiskValuePlay: false,
      recommends: false,
      factors: [],
      rubric: {
        scores: { lineShopping: 5 },
        composite: 6,
        grade: "C+",
        confidencePct: 60,
        edgePct: 1.1,
      },
    },
    scores: {
      scores: { lineShopping: 5 },
      composite: 6,
      grade: "C+",
      confidencePct: 60,
      edgePct: 1.1,
    },
  };
  assert.equal(pickHasLineMarketSignal(pick), false);
});
