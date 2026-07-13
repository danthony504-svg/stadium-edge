import assert from "node:assert/strict";
import test from "node:test";

import {
  boardLegsNearlyEqual,
  compareBoardLegsForRank,
  sortBoardLegsForRank,
} from "./coachBoardRankVariety.ts";
import type { BoardScoredLeg } from "./ticketStaging.ts";

function leg(
  player: string,
  rankScore: number,
  edgePct: number,
  confidencePct: number,
): BoardScoredLeg {
  return {
    pick: {
      game: "Away @ Home",
      player,
      market: "Points",
      pick: `${player} Over 20.5 Points`,
      isProp: true,
    } as BoardScoredLeg["pick"],
    evPct: edgePct,
    edgePct,
    confidencePct,
    impliedProbPct: 50,
    lineShoppingScore: null,
    grade: "B+",
    simHit: 55,
    composite: rankScore,
    rankScore,
  };
}

test("compareBoardLegsForRank keeps clear edge winner first", () => {
  const a = leg("Star A", 80, 20, 60);
  const b = leg("Star B", 75, 14, 58);
  assert.ok(compareBoardLegsForRank(a, b, "seed") < 0);
});

test("compareBoardLegsForRank rotates when nearly equal", () => {
  const a = leg("Player A", 78, 16.2, 52);
  const b = leg("Player B", 77.5, 16.0, 51);
  assert.equal(boardLegsNearlyEqual(a, b), true);
  const seedA = compareBoardLegsForRank(a, b, "build-alpha");
  const seedB = compareBoardLegsForRank(a, b, "build-beta");
  assert.notEqual(Math.sign(seedA), Math.sign(seedB));
});

test("sortBoardLegsForRank does not demote a stronger edge", () => {
  const rows = sortBoardLegsForRank(
    [leg("Weak", 70, 10, 50), leg("Strong", 85, 24, 62)],
    "any-seed",
  );
  assert.equal(rows[0]?.pick.player, "Strong");
});
