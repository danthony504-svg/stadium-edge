import test from "node:test";
import assert from "node:assert/strict";
import {
  boardPropSimExpansionBatchSize,
  boardPropSimInitialBatchSize,
  countQualifiedBoardLegs,
  isRealisticBoardPropCandidate,
  selectBoardPropSimCandidates,
} from "./boardPropSimExpansion.ts";
import type { BoardScoredLeg } from "./ticketStaging.ts";
import type { ParsedPick } from "../components/PickCard.tsx";

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

function rankedPick(player: string, line: number, rank: number): ParsedPick {
  return {
    game: "NYY @ WSH",
    market: "Total Bases",
    pick: `${player} Over ${line} Total Bases`,
    odds: -110 - rank,
    isProp: true,
    sport: "mlb",
    player,
    propLine: line,
    propSide: "Over",
    propIsAlt: line > 1.5,
    finalAiScore: { ...qualScore, composite: 10 - rank / 10 },
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

test("isRealisticBoardPropCandidate admits posted binary milestone markets", () => {
  assert.equal(
    isRealisticBoardPropCandidate({
      game: "KC @ BUF",
      market: "Anytime Touchdown",
      pick: "Runner Anytime TD",
      odds: 145,
      isProp: true,
      sport: "nfl",
      player: "Runner",
      propMarketKey: "player_anytime_td",
    }),
    true,
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

test("selectBoardPropSimCandidates ladder-dedupes then caps before deep sim", () => {
  const ranked: ParsedPick[] = [];
  for (let i = 0; i < 20; i++) {
    ranked.push(rankedPick(`Player${i}`, 1.5, i));
    ranked.push(rankedPick(`Player${i}`, 2.5, i + 0.5));
  }
  assert.equal(ranked.length, 40);
  const { selected, skippedCount } = selectBoardPropSimCandidates(ranked, 25);
  assert.equal(selected.length, 25);
  assert.equal(skippedCount, 15);
  const firstLadders = selected.slice(0, 20).map((p) => `${p.player}|${p.propLine}`);
  assert.equal(
    firstLadders.filter((k) => k.endsWith("|1.5")).length,
    20,
    "best rung per ladder is preferred before filling with alts",
  );
});
