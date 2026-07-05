import assert from "node:assert/strict";
import test from "node:test";
import type { ParsedPick } from "../components/PickCard.tsx";
import {
  buildGameCoverQuery,
  gameSimAgreesWithPick,
  gameSimDisagreement,
  gameSimHitForPick,
} from "./gameSimScoring.ts";

function gamePick(overrides: Partial<ParsedPick> = {}): ParsedPick {
  return {
    game: "New York Mets @ Atlanta Braves",
    market: "Spread",
    pick: "Braves -1.5",
    odds: 165,
    isProp: false,
    sport: "mlb",
    ...overrides,
  };
}

const sim = {
  sport: "mlb",
  simulations: 10_000,
  homeWinProbability: 0.467,
  awayWinProbability: 0.533,
  tieProbability: 0,
  homeProjectedScore: 4.5,
  awayProjectedScore: 4.5,
  mostLikelyWinner: "home" as const,
  mostLikelyWinnerPct: 0.467,
  confidenceScore: 55,
  coverHitRates: {
    "new york mets @ atlanta braves|spread|braves -1.5": 0.38,
  },
};

test("buildGameCoverQuery for home spread", () => {
  const q = buildGameCoverQuery(gamePick());
  assert.equal(q?.kind, "spread");
  assert.equal(q?.teamSide, "home");
  assert.equal(q?.line, -1.5);
});

test("gameSimHitForPick reads coverHitRates", () => {
  const hit = gameSimHitForPick(gamePick(), sim);
  assert.equal(hit, 0.38);
});

test("gameSimDisagreement when hit below floor", () => {
  const d = gameSimDisagreement(gamePick(), sim);
  assert.ok(d);
  assert.match(d!.reason, /38%/);
});

test("gameSimAgreesWithPick for strong home ML", () => {
  const mlPick = gamePick({ market: "Moneyline", pick: "Braves ML" });
  const mlSim = {
    ...sim,
    coverHitRates: {
      "new york mets @ atlanta braves|moneyline|braves ml": 0.58,
    },
  };
  assert.equal(gameSimAgreesWithPick(mlPick, mlSim), true);
  assert.equal(gameSimDisagreement(mlPick, mlSim), null);
});
