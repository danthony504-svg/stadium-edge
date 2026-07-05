import assert from "node:assert/strict";
import test from "node:test";
import {
  buildBoardQualityIndex,
  marketFamilyKey,
  passesBoardQuality,
} from "./boardPropQuality.ts";
import type { PropDualScore } from "./propDualScore.ts";
import {
  playerMatchupAgree,
  boardRankScore,
  buildPropDualVerdict,
  MIN_FINAL_AI_SCORE,
} from "./propDualScore.ts";

function mockTriple(
  player: number,
  matchup: number,
  finalAi: number,
): PropDualScore {
  const verdict = buildPropDualVerdict(player, matchup, finalAi);
  return {
    playerScore: player,
    matchupScore: matchup,
    finalAiScore: finalAi,
    playerFactors: [],
    matchupFactors: [],
    finalAiFactors: [],
    passesPlayer: player >= 55,
    passesMatchup: matchup >= 55,
    passesFinalAi: finalAi >= MIN_FINAL_AI_SCORE,
    playerMatchupAgree: verdict.playerMatchupAgree,
    recommends: verdict.recommends,
    headline: verdict.headline,
    explanation: verdict.explanation,
  };
}

test("playerMatchupAgree: rejects hot player + cold matchup", () => {
  const r = playerMatchupAgree(72, 40);
  assert.equal(r.agrees, false);
  assert.match(r.reason, /tough matchup/i);
});

test("playerMatchupAgree: rejects when weaker side below agreement floor", () => {
  const r = playerMatchupAgree(64, 56);
  assert.equal(r.agrees, false);
  assert.match(r.reason, /don't agree/i);
});

test("playerMatchupAgree: accepts aligned solid scores", () => {
  const r = playerMatchupAgree(62, 60);
  assert.equal(r.agrees, true);
});

test("boardRankScore: null when player and matchup disagree", () => {
  assert.equal(boardRankScore(mockTriple(70, 42, 65)), null);
});

test("buildBoardQualityIndex: only best in family passes board gate", () => {
  const sb = marketFamilyKey("batter_stolen_bases");
  const idx = buildBoardQualityIndex([
    { key: "a", marketFamily: sb, triple: mockTriple(65, 63, 68) },
    { key: "b", marketFamily: sb, triple: mockTriple(58, 58, 60) },
    { key: "c", marketFamily: "points", triple: mockTriple(70, 68, 72) },
  ]);
  assert.equal(passesBoardQuality(idx.get("a")), true);
  assert.equal(passesBoardQuality(idx.get("b")), false);
  assert.equal(passesBoardQuality(idx.get("c")), true);
});

test("buildPropDualVerdict: requires agreement for recommend", () => {
  const v = buildPropDualVerdict(64, 56, 62);
  assert.equal(v.recommends, false);
  assert.equal(v.playerMatchupAgree, false);
});
