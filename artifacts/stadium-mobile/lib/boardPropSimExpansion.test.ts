import test from "node:test";
import assert from "node:assert/strict";
import {
  boardPropSimExpansionBatchSize,
  boardPropSimInitialBatchSize,
  countQualifiedBoardLegs,
  isRealisticBoardPropCandidate,
  boardPropSlotTarget,
  countStagedPropLegs,
  shouldStopPropSimForTicketMix,
  selectBoardPropSimCandidates,
} from "./boardPropSimExpansion.ts";
import type { BoardScoredLeg } from "./ticketStaging.ts";

const qualScore = {
  composite: 7,
  grade: "C+",
  confidencePct: 55,
  edgePct: 2,
  simHit: 0.55,
  simAligned: true,
  highRiskValuePlay: false,
  recommends: true,
  factors: [],
  rubric: { composite: 7, grade: "C+", confidencePct: 55, edgePct: 2, scores: {} as never },
};

function propLeg(
  player: string,
  line: number,
  odds: number,
  propIsAlt: boolean,
  rankScore: number,
): BoardScoredLeg {
  return {
    pick: {
      game: "NYY @ WSH",
      market: "Total Bases",
      pick: `${player} Over ${line} Total Bases`,
      odds,
      isProp: true,
      sport: "mlb",
      player,
      propLine: line,
      propSide: "Over",
      propIsAlt,
      finalAiScore: qualScore,
    },
    evPct: 3,
    edgePct: 2,
    confidencePct: 55,
    impliedProbPct: 45,
    lineShoppingScore: 1,
    grade: "C+",
    simHit: 0.55,
    composite: 7,
    rankScore,
  };
}

test("isRealisticBoardPropCandidate requires sim-supported market and posted odds", () => {
  assert.equal(
    isRealisticBoardPropCandidate({
      game: "A @ B",
      market: "Points",
      pick: "Player Over 24.5 Points",
      odds: -110,
      isProp: true,
      sport: "nba",
      player: "Player",
      propLine: 24.5,
      propSide: "Over",
    }),
    true,
  );
  assert.equal(
    isRealisticBoardPropCandidate({
      game: "A @ B",
      market: "MVP",
      pick: "Player MVP",
      odds: 500,
      isProp: true,
      sport: "nba",
    }),
    false,
    "futures without a line/side are not sim candidates",
  );
});

test("boardPropSim batch sizes grow with leg target", () => {
  assert.equal(boardPropSimInitialBatchSize(6), 21);
  assert.equal(boardPropSimInitialBatchSize(15), 30);
  assert.equal(boardPropSimExpansionBatchSize(15), 60);
});

test("countQualifiedBoardLegs collapses duplicate ladder rungs before counting fill", () => {
  const players = ["Grisham", "Judge", "Soto", "Stanton", "Rizzo"];
  const scored: BoardScoredLeg[] = [];
  for (const [i, player] of players.entries()) {
    scored.push(propLeg(player, 1.5, 130 + i, false, 90 - i));
    scored.push(propLeg(player, 2.5, 250 + i, true, 80 - i));
  }
  assert.equal(scored.length, 10, "ten qualifying rungs before ladder collapse");
  assert.equal(countQualifiedBoardLegs(scored, 9), 5, "only one rung per player/market ladder counts");
});


test("prop-slot target is ~50% of legs", () => {
  assert.equal(boardPropSlotTarget(6), 3);
  assert.equal(boardPropSlotTarget(5), 3);
  assert.equal(boardPropSlotTarget(2), 0);
});

test("prop sim does not stop on game-line-only full ticket", () => {
  const gameOnly = [];
  for (let i = 0; i < 6; i++) {
    gameOnly.push({
      pick: {
        game: `A${i} @ B${i}`,
        market: "Spread",
        pick: `A${i} -3.5`,
        odds: -110,
        isProp: false,
        sport: "nfl",
        finalAiScore: qualScore,
      },
      evPct: 3,
      edgePct: 2,
      confidencePct: 55,
      impliedProbPct: 45,
      lineShoppingScore: 1,
      grade: "C+",
      simHit: 0.55,
      composite: 7,
      rankScore: 90 - i,
    });
  }
  assert.equal(
    shouldStopPropSimForTicketMix({ scored: gameOnly, target: 6 }),
    false,
    "full game-line ticket must keep scoring props",
  );
});

test("prop sim stops once mix fills prop slots", () => {
  const scored = [];
  for (let i = 0; i < 3; i++) {
    scored.push({
      pick: {
        game: `G${i} @ H${i}`,
        market: "Spread",
        pick: `G${i} -2.5`,
        odds: -110,
        isProp: false,
        sport: "nfl",
        finalAiScore: qualScore,
      },
      evPct: 3,
      edgePct: 2,
      confidencePct: 55,
      impliedProbPct: 45,
      lineShoppingScore: 1,
      grade: "C+",
      simHit: 0.55,
      composite: 7,
      rankScore: 90 - i,
    });
  }
  for (let i = 0; i < 3; i++) {
    scored.push(propLeg(`Player${i}`, 1.5 + i, 120 + i, false, 80 - i));
  }
  assert.equal(
    shouldStopPropSimForTicketMix({ scored, target: 6 }),
    true,
  );
});

test("selectBoardPropSimCandidates caps and ladder-dedupes", () => {
  const ranked = [];
  for (let i = 0; i < 10; i++) {
    ranked.push({
      game: "NYY @ WSH",
      market: "Total Bases",
      pick: `Grisham Over ${1.5 + (i % 2)} Total Bases`,
      odds: 130 + i,
      isProp: true,
      sport: "mlb",
      player: "Grisham",
      propLine: 1.5 + (i % 2),
      propSide: "Over",
      propIsAlt: i % 2 === 1,
    });
  }
  const { selected, skippedCount } = selectBoardPropSimCandidates(ranked, 3);
  assert.equal(selected.length, 3);
  assert.equal(skippedCount, 7);
});

test("selectBoardPropSimCandidates keeps multiple alt yard rungs per player ladder", () => {
  const ranked = [];
  for (const line of [67.5, 99.5, 124.5, 149.5, 174.5]) {
    ranked.push({
      game: "DEN @ KC",
      market: "Rush Yds",
      pick: `Barkley Over ${line} Rush Yds`,
      odds: -110,
      isProp: true,
      sport: "nfl",
      player: "Barkley",
      propLine: line,
      propSide: "Over",
      propIsAlt: line !== 67.5,
    });
  }
  // Other players so deferred fill is not required
  for (let i = 0; i < 5; i++) {
    ranked.push({
      game: "DEN @ KC",
      market: "Pass Yds",
      pick: `QB${i} Over 250.5 Pass Yds`,
      odds: -110,
      isProp: true,
      sport: "nfl",
      player: `QB${i}`,
      propLine: 250.5,
      propSide: "Over",
      propIsAlt: false,
    });
  }
  const { selected } = selectBoardPropSimCandidates(ranked, 8);
  const barkley = selected.filter((p) => p.player === "Barkley");
  assert.equal(barkley.length, 3, "main + two alt yard numbers reach deep sim");
  assert.deepEqual(
    barkley.map((p) => p.propLine),
    [67.5, 99.5, 124.5],
  );
});
