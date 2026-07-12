import test from "node:test";
import assert from "node:assert/strict";
import {
  boardPropSimExpansionBatchSize,
  boardPropSimInitialBatchSize,
  isRealisticBoardPropCandidate,
} from "./boardPropSimExpansion.ts";

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
