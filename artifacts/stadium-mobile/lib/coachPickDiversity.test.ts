import assert from "node:assert/strict";
import test from "node:test";

import type { ParsedPick } from "../components/PickCard.tsx";
import {
  buildIndependentCoachTicket,
} from "./coachTicketCombinations.ts";
import {
  canAddPickToTicket,
  conflictsWithTicket,
  dedupeTicketByNormalizedKey,
  dominantGameShare,
  dominantMarketShare,
  maxPicksPerGame,
  maxPicksPerMarket,
  normalizedCoachPickKey,
  ticketCoreOverlapRatio,
} from "./coachPickDiversity.ts";
import {
  clearParlayVarietyMemory,
  rememberParlayBuild,
  recentParlayLegKeys,
  recentParlayVarietyContext,
} from "./parlayVarietyMemory.ts";
import type { BoardScoredLeg } from "./ticketStaging.ts";

const mainScore = {
  composite: 8,
  grade: "B+",
  confidencePct: 58,
  edgePct: 16,
  simHit: 0.56,
  simAligned: true,
  highRiskValuePlay: false,
  recommends: true,
  factors: [],
  rubric: { composite: 8, grade: "B+", confidencePct: 58, edgePct: 16, scores: {} as never },
};

function propLeg(
  player: string,
  game: string,
  market: string,
  side: "Over" | "Under",
  line: number,
  edge: number,
  rank: number,
  sport = "mlb",
): BoardScoredLeg {
  return {
    pick: {
      game,
      player,
      market,
      propMarketKey: market.toLowerCase().replace(/\+/g, "_"),
      pick: `${player} ${side} ${line} ${market}`,
      propSide: side,
      propLine: line,
      isProp: true,
      sport,
      odds: -110,
      finalAiScore: { ...mainScore, edgePct: edge, composite: rank },
    } as ParsedPick,
    evPct: edge,
    edgePct: edge,
    confidencePct: 58,
    impliedProbPct: 50,
    lineShoppingScore: null,
    grade: "B+",
    simHit: 56,
    composite: rank,
    rankScore: rank,
  };
}

test("normalizedCoachPickKey includes sport, event, player, market, line, and side", () => {
  const over = normalizedCoachPickKey({
    sport: "mlb",
    game: "Cleveland Guardians @ Pittsburgh Pirates",
    player: "Bryan Reynolds",
    market: "Hits+Runs+RBIs",
    propMarketKey: "player_hits_runs_rbis",
    pick: "Bryan Reynolds Over 1.5 Hits+Runs+RBIs",
    propSide: "Over",
    propLine: 1.5,
    isProp: true,
    odds: -110,
  } as ParsedPick);
  const under = normalizedCoachPickKey({
    sport: "mlb",
    game: "Cleveland Guardians @ Pittsburgh Pirates",
    player: "Bryan Reynolds",
    market: "Hits+Runs+RBIs",
    propMarketKey: "player_hits_runs_rbis",
    pick: "Bryan Reynolds Under 1.5 Hits+Runs+RBIs",
    propSide: "Under",
    propLine: 1.5,
    isProp: true,
    odds: -110,
  } as ParsedPick);
  assert.notEqual(over, under);
});

test("no exact duplicate inside the same ticket", () => {
  const pick = propLeg("A", "G1 @ H1", "Points", "Over", 1.5, 18, 90).pick;
  const ticket = [pick];
  assert.equal(conflictsWithTicket(pick, ticket), "duplicate");
  const deduped = dedupeTicketByNormalizedKey([pick, pick, pick]);
  assert.equal(deduped.length, 1);
});

test("rejects conflicting over and under for same player and market", () => {
  const over = propLeg(
    "Bryan Reynolds",
    "Guardians @ Pirates",
    "Hits+Runs+RBIs",
    "Over",
    1.5,
    18,
    90,
  ).pick;
  const under = propLeg(
    "Bryan Reynolds",
    "Guardians @ Pirates",
    "Hits+Runs+RBIs",
    "Under",
    1.5,
    17,
    88,
  ).pick;
  assert.equal(conflictsWithTicket(under, [over]), "same-player");
});

test("same-game and market concentration limits apply before relaxation", () => {
  const game = "Cleveland Guardians @ Pittsburgh Pirates";
  const a = propLeg("Player A", game, "Hits+Runs+RBIs", "Over", 0.5, 20, 100).pick;
  const b = propLeg("Player B", game, "Hits+Runs+RBIs", "Under", 0.5, 19, 99).pick;
  const c = propLeg("Player C", game, "Total Bases", "Over", 1.5, 18, 98).pick;
  const ticket = [a, b];
  assert.equal(maxPicksPerGame(5), 2);
  const verdict = canAddPickToTicket(c, ticket, 5, { structureRelaxation: 0 });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.reason, "same-game-limit");
});

test("5-leg and 15-leg requests do not return mostly the same core picks", () => {
  clearParlayVarietyMemory();
  const guardiansGame = "Cleveland Guardians @ Pittsburgh Pirates";
  const scored: BoardScoredLeg[] = [
    propLeg("Jacob Gonzalez", guardiansGame, "Hits+Runs+RBIs", "Under", 0.5, 22, 100),
    propLeg("Travis Bazzana", guardiansGame, "Hits+Runs+RBIs", "Under", 1.5, 21.5, 99),
    propLeg("Bryan Reynolds", guardiansGame, "Hits+Runs+RBIs", "Over", 1.5, 21, 98),
    propLeg("Oneil Cruz", guardiansGame, "Total Bases", "Over", 1.5, 20.5, 97),
    propLeg("Ke'Bryan Hayes", guardiansGame, "Hits", "Over", 0.5, 20, 96),
  ];
  for (let i = 0; i < 24; i++) {
    scored.push(
      propLeg(
        `Player ${i}`,
        `Team${i} @ Team${i + 1}`,
        i % 2 === 0 ? "Hits+Runs+RBIs" : "Total Bases",
        i % 3 === 0 ? "Under" : "Over",
        1.5,
        19 - i * 0.2,
        95 - i,
      ),
    );
  }

  const five = buildIndependentCoachTicket(scored, 5, {
    varietySeed: "pirates-board-5",
  }).picks;
  rememberParlayBuild(five);

  const fifteen = buildIndependentCoachTicket(scored, 15, {
    varietySeed: "pirates-board-15",
    ...recentParlayVarietyContext(),
    recentLegKeys: recentParlayLegKeys(),
  }).picks;

  assert.equal(five.length, 5);
  assert.equal(fifteen.length, 15);
  const overlap = ticketCoreOverlapRatio(five, fifteen);
  assert.ok(
    overlap <= 0.4,
    `expected <=40% core overlap between 5-leg and 15-leg, got ${(overlap * 100).toFixed(0)}%`,
  );
  const guardiansOnFive = five.filter((p) => p.game === guardiansGame).length;
  const guardiansOnFifteen = fifteen.filter((p) => p.game === guardiansGame).length;
  assert.ok(guardiansOnFive <= maxPicksPerGame(5), `5-leg had ${guardiansOnFive} from one game`);
  assert.ok(
    guardiansOnFifteen <= maxPicksPerGame(15),
    `15-leg had ${guardiansOnFifteen} from one game`,
  );
});

test("15-leg ticket is not dominated by one game or one market", () => {
  clearParlayVarietyMemory();
  const scored: BoardScoredLeg[] = [];
  const markets = ["Hits+Runs+RBIs", "Total Bases", "Hits"];
  for (let g = 0; g < 10; g++) {
    for (let p = 0; p < 4; p++) {
      scored.push(
        propLeg(
          `G${g} Player ${p}`,
          `Away${g} @ Home${g}`,
          markets[p % markets.length]!,
          "Over",
          1.5,
          24 - g * 0.5 - p * 0.1,
          100 - g * 4 - p,
        ),
      );
    }
  }

  const fifteen = buildIndependentCoachTicket(scored, 15, {
    varietySeed: "spread-board-15",
  }).picks;

  assert.equal(fifteen.length, 15);
  assert.ok(
    dominantGameShare(fifteen) <= maxPicksPerGame(15) / 15 + 0.01,
    `one game dominated at ${(dominantGameShare(fifteen) * 100).toFixed(0)}%`,
  );
  assert.ok(
    dominantMarketShare(fifteen) <= maxPicksPerMarket(15) / 15 + 0.01,
    `one market dominated at ${(dominantMarketShare(fifteen) * 100).toFixed(0)}%`,
  );

  const keys = fifteen.map((p) => normalizedCoachPickKey(p));
  assert.equal(keys.length, new Set(keys).size, "ticket contained duplicate normalized keys");
});
