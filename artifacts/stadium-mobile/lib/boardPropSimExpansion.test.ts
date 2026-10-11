import test from "node:test";
import assert from "node:assert/strict";
import {
  boardPropSimEarlyStopReserve,
  boardPropSimExpansionBatchSize,
  boardPropSimFillCapacity,
  boardPropSimInitialBatchSize,
  countQualifiedBoardLegs,
  isRealisticBoardPropCandidate,
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

test("boardPropSimEarlyStopReserve scales with target", () => {
  assert.equal(boardPropSimEarlyStopReserve(4), 2);
  assert.equal(boardPropSimEarlyStopReserve(7), 3);
  assert.equal(boardPropSimEarlyStopReserve(10), 3);
});

test("boardPropSimFillCapacity requires target+reserve after ladder collapse — not raw qualified count", () => {
  const players = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"];
  const scored: BoardScoredLeg[] = [];
  for (const [i, player] of players.entries()) {
    scored.push(propLeg(player, 1.5, 130 + i, false, 90 - i));
    scored.push(propLeg(player, 2.5, 250 + i, true, 80 - i));
  }
  // 20 raw qualifying rungs, but only 10 after ladder/one-player collapse.
  assert.equal(scored.length, 20);
  const target = 7;
  const fill = boardPropSimFillCapacity(scored, target);
  assert.equal(fill.need, target + boardPropSimEarlyStopReserve(target));
  assert.equal(fill.ready, fill.seated >= fill.need);
  assert.ok(fill.seated >= target, "staging can seat at least the ask");
  // Raw count would say 20 >= need; fill capacity must use staging (≤10 unique).
  assert.ok(fill.seated <= 10, "ladder/one-player collapse bounds seated capacity");
});

test("boardPropSimFillCapacity not ready when staged pool is short of target+reserve", () => {
  const scored: BoardScoredLeg[] = [
    propLeg("Only", 1.5, 130, false, 90),
    propLeg("Only", 2.5, 250, true, 80),
  ];
  const fill = boardPropSimFillCapacity(scored, 7);
  assert.equal(fill.ready, false);
  assert.ok(fill.seated < fill.need);
});
