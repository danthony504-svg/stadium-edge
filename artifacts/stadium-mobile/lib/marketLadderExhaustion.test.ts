import assert from "node:assert/strict";
import test from "node:test";
import { collapseScoredLegsByMarketLadder, marketLadderKey } from "./marketLadderExhaustion.ts";
import type { BoardScoredLeg } from "./ticketStaging.ts";

const mainScore = {
  composite: 8,
  grade: "B+",
  confidencePct: 58,
  edgePct: 4,
  simHit: 0.56,
  simAligned: true,
  highRiskValuePlay: false,
  recommends: true,
  factors: [],
  rubric: { composite: 8, grade: "B+", confidencePct: 58, edgePct: 4, scores: {} as never },
};

const altScore = {
  composite: 6,
  grade: "C+",
  confidencePct: 52,
  edgePct: 1.5,
  simHit: 0.53,
  simAligned: true,
  highRiskValuePlay: false,
  recommends: false,
  factors: [],
  rubric: { composite: 6, grade: "C+", confidencePct: 52, edgePct: 1.5, scores: {} as never },
};

const belowBar = {
  composite: 4,
  grade: "C",
  confidencePct: 48,
  edgePct: -0.5,
  simHit: 0.48,
  simAligned: false,
  highRiskValuePlay: false,
  recommends: false,
  factors: [],
  rubric: { composite: 4, grade: "C", confidencePct: 48, edgePct: -0.5, scores: {} as never },
};

function leg(
  pick: {
    game: string;
    market: string;
    pick: string;
    odds: number;
    isProp?: boolean;
    propIsAlt?: boolean;
    player?: string;
    propSide?: string;
  },
  rankScore: number,
  finalAiScore: typeof mainScore,
): BoardScoredLeg {
  return {
    pick: { sport: "mlb", isProp: false, ...pick, finalAiScore },
    evPct: 2,
    edgePct: 3,
    confidencePct: 55,
    impliedProbPct: 50,
    lineShoppingScore: 1,
    grade: finalAiScore.grade,
    simHit: finalAiScore.simHit,
    composite: finalAiScore.composite,
    rankScore,
  };
}

test("marketLadderKey groups alt spreads with main spread on the same side", () => {
  const main = marketLadderKey({
    game: "A @ B",
    market: "Spread",
    pick: "A +1.5",
    odds: -110,
    isProp: false,
  });
  const alt = marketLadderKey({
    game: "A @ B",
    market: "Alt Spread",
    pick: "A +3.5",
    odds: 120,
    isProp: false,
  });
  assert.equal(main, alt);
});

test("collapseScoredLegsByMarketLadder keeps main when it qualifies and outranks alt", () => {
  const scored = [
    leg({ game: "A @ B", market: "Spread", pick: "A +1.5", odds: -110 }, 100, mainScore),
    leg({ game: "A @ B", market: "Alt Spread", pick: "A +3.5", odds: 120 }, 90, altScore),
  ];
  const out = collapseScoredLegsByMarketLadder(scored);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.pick.market, "Spread");
});

test("collapseScoredLegsByMarketLadder prefers higher-scoring Alt Spread over main", () => {
  const scored = [
    leg({ game: "KC @ BUF", market: "Spread", pick: "KC -3", odds: -110 }, 70, mainScore),
    // Plus-money alt so sim edge clears the alt quality bar (same as promote-on-fail fixture).
    leg({ game: "KC @ BUF", market: "Alt Spread", pick: "KC +6.5", odds: 120 }, 95, altScore),
  ];
  const out = collapseScoredLegsByMarketLadder(scored);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.pick.market, "Alt Spread");
  assert.match(out[0]!.pick.pick, /\+6\.5/);
});

test("collapseScoredLegsByMarketLadder promotes alt when main fails quality bar", () => {
  const scored = [
    leg({ game: "A @ B", market: "Spread", pick: "A +1.5", odds: -110 }, 100, belowBar),
    leg({ game: "A @ B", market: "Alt Spread", pick: "A +3.5", odds: 120 }, 90, altScore),
  ];
  const out = collapseScoredLegsByMarketLadder(scored);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.pick.market, "Alt Spread");
});

test("collapseScoredLegsByMarketLadder drops ladder when no rung qualifies", () => {
  const scored = [
    leg({ game: "A @ B", market: "Spread", pick: "A +1.5", odds: -110 }, 100, belowBar),
    leg({ game: "A @ B", market: "Alt Spread", pick: "A +3.5", odds: 120 }, 90, belowBar),
  ];
  assert.equal(collapseScoredLegsByMarketLadder(scored).length, 0);
});

test("prop ladder keeps higher-scoring alt yard number over main O/U", () => {
  const scored = [
    leg(
      {
        game: "DEN @ KC",
        market: "Rush Yds",
        pick: "Barkley Over 67.5 Rush Yds",
        odds: -110,
        isProp: true,
        propIsAlt: false,
        player: "Barkley",
        propSide: "Over",
      },
      70,
      mainScore,
    ),
    leg(
      {
        game: "DEN @ KC",
        market: "Rush Yds",
        pick: "Barkley Over 149.5 Rush Yds",
        odds: 250,
        isProp: true,
        propIsAlt: true,
        player: "Barkley",
        propSide: "Over",
      },
      95,
      altScore,
    ),
  ];
  const out = collapseScoredLegsByMarketLadder(scored);
  assert.equal(out.length, 1);
  assert.match(out[0]!.pick.pick, /149\.5/);
  assert.equal(out[0]!.pick.propIsAlt, true);
});

test("prop ladder still keeps main when it outranks alt yard numbers", () => {
  const scored = [
    leg(
      {
        game: "DEN @ KC",
        market: "Pass Yds",
        pick: "Mahomes Over 265.5 Pass Yds",
        odds: -110,
        isProp: true,
        propIsAlt: false,
        player: "Mahomes",
        propSide: "Over",
      },
      100,
      mainScore,
    ),
    leg(
      {
        game: "DEN @ KC",
        market: "Pass Yds",
        pick: "Mahomes Over 299.5 Pass Yds",
        odds: 180,
        isProp: true,
        propIsAlt: true,
        player: "Mahomes",
        propSide: "Over",
      },
      80,
      altScore,
    ),
  ];
  const out = collapseScoredLegsByMarketLadder(scored);
  assert.equal(out.length, 1);
  assert.match(out[0]!.pick.pick, /265\.5/);
  assert.equal(out[0]!.pick.propIsAlt, false);
});
