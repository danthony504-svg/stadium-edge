import assert from "node:assert/strict";
import test from "node:test";
import {
  collapseScoredLegsByMarketLadder,
  marketLadderKey,
  marketLadderScoreKey,
  wouldRepeatMarketLadder,
  dedupePicksByMarketLadder,
} from "./marketLadderExhaustion.ts";
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
    propLine?: number;
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

test("marketLadderScoreKey keeps distinct thresholds separate", () => {
  const main = marketLadderScoreKey({
    game: "A @ B",
    market: "Spread",
    pick: "A +1.5",
    isProp: false,
  });
  const alt = marketLadderScoreKey({
    game: "A @ B",
    market: "Alt Spread",
    pick: "A +3.5",
    isProp: false,
  });
  assert.notEqual(main, alt);
});

test("collapseScoredLegsByMarketLadder keeps distinct qualifying thresholds", () => {
  const scored = [
    leg({ game: "A @ B", market: "Spread", pick: "A +1.5", odds: -110 }, 100, mainScore),
    leg({ game: "A @ B", market: "Alt Spread", pick: "A +3.5", odds: 120 }, 90, altScore),
  ];
  const out = collapseScoredLegsByMarketLadder(scored);
  assert.equal(out.length, 2);
  assert.ok(out.some((l) => l.pick.market === "Spread"));
  assert.ok(out.some((l) => l.pick.market === "Alt Spread"));
});

test("collapseScoredLegsByMarketLadder drops below-bar rung but keeps qualifying alt threshold", () => {
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

test("prop ladder preserves distinct main and alt yard thresholds for scoring", () => {
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
        propLine: 67.5,
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
        propLine: 149.5,
      },
      95,
      altScore,
    ),
  ];
  const out = collapseScoredLegsByMarketLadder(scored);
  assert.equal(out.length, 2);
  assert.ok(out.some((l) => /149\.5/.test(l.pick.pick)));
  assert.ok(out.some((l) => /67\.5/.test(l.pick.pick)));
});

test("correlated prop rungs cannot both seat — wouldRepeatMarketLadder", () => {
  const main = {
    game: "DEN @ KC",
    market: "Rush Yds",
    pick: "Barkley Over 67.5 Rush Yds",
    isProp: true as const,
    player: "Barkley",
    propSide: "Over",
    propLine: 67.5,
  };
  const alt = {
    game: "DEN @ KC",
    market: "Rush Yds",
    pick: "Barkley Over 149.5 Rush Yds",
    isProp: true as const,
    player: "Barkley",
    propSide: "Over",
    propLine: 149.5,
  };
  assert.equal(wouldRepeatMarketLadder(alt, [main]), true);
  assert.equal(
    dedupePicksByMarketLadder([
      { ...main, odds: -110, sport: "nfl", finalAiScore: mainScore },
      { ...alt, odds: 250, sport: "nfl", finalAiScore: { ...altScore, composite: 12 } },
    ] as never).length,
    1,
  );
});

test("prop ladder still keeps main and lower-ranked alt as separate score keys", () => {
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
        propLine: 265.5,
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
        propLine: 299.5,
      },
      80,
      altScore,
    ),
  ];
  const out = collapseScoredLegsByMarketLadder(scored);
  assert.equal(out.length, 2);
  assert.ok(out.some((l) => /265\.5/.test(l.pick.pick)));
  assert.ok(out.some((l) => /299\.5/.test(l.pick.pick)));
});
