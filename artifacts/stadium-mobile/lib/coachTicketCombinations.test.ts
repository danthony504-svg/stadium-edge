import assert from "node:assert/strict";
import test from "node:test";

import type { ParsedPick } from "../components/PickCard.tsx";
import {
  buildIndependentCoachTicket,
  isPrefixTicket,
  NEAR_EQUAL_TICKET_EDGE_PCT,
  TICKET_CANDIDATE_COUNT,
} from "./coachTicketCombinations.ts";
import { clearParlayVarietyMemory, parlayLegKey, rememberParlayBuild, recentParlayTicketLegSets, ticketOverlapRatio } from "./parlayVarietyMemory.ts";
import type { BoardScoredLeg } from "./ticketStaging.ts";
import { buildStagedTicketFromScan } from "./ticketStaging.ts";

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
  edge: number,
  rank: number,
): BoardScoredLeg {
  return {
    pick: {
      game,
      player,
      market,
      pick: `${player} Over 1.5 ${market}`,
      isProp: true,
      odds: -110,
      sport: "wnba",
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

function mainGame(game: string, rank: number): BoardScoredLeg {
  return {
    pick: {
      game,
      market: "Spread",
      pick: "Away +3.5",
      odds: -110,
      isProp: false,
      sport: "wnba",
      finalAiScore: { ...mainScore, edgePct: 8, composite: rank },
    } as ParsedPick,
    evPct: 8,
    edgePct: 8,
    confidencePct: 55,
    impliedProbPct: 50,
    lineShoppingScore: null,
    grade: "B",
    simHit: 54,
    composite: rank,
    rankScore: rank,
  };
}

test("buildIndependentCoachTicket avoids repeating the same player when near-equal alts exist", () => {
  const scored: BoardScoredLeg[] = [
    propLeg("Allisha Gray", "Sparks @ Dream", "Assists", 18, 90),
    propLeg("Allisha Gray", "Sparks @ Dream", "3-Pointers", 17.5, 88),
    propLeg("Natasha Howard", "Mercury @ Lynx", "Assists", 17, 87),
    propLeg("Jordin Canada", "Sparks @ Dream", "Rebounds", 16.5, 86),
    propLeg("Kahleah Copper", "Mercury @ Lynx", "Pts+Reb", 16, 85),
    propLeg("Kahleah Copper", "Mercury @ Lynx", "Rebounds", 15.5, 84),
    propLeg("Player Seven", "A @ B", "Points", 15, 83),
    propLeg("Player Eight", "C @ D", "Points", 14.5, 82),
    mainGame("E @ F", 70),
    mainGame("G @ H", 68),
  ];
  const { picks } = buildIndependentCoachTicket(scored, 6, {
    varietySeed: "wnba-six-leg",
  });
  assert.equal(picks.length, 6);
  const players = picks.filter((p) => p.player).map((p) => p.player!.toLowerCase());
  const uniquePlayers = new Set(players);
  assert.ok(
    uniquePlayers.size >= players.length - 1,
    "expected at most one duplicate player on a 6-leg ticket",
  );
});

test("6-leg and 15-leg tickets are built independently — not a prefix slice", () => {
  const scored: BoardScoredLeg[] = [];
  const players = [
    "Allisha Gray",
    "Natasha Howard",
    "Jordin Canada",
    "Kahleah Copper",
    "Player A",
    "Player B",
    "Player C",
    "Player D",
    "Player E",
    "Player F",
  ];
  players.forEach((name, i) => {
    scored.push(propLeg(name, `G${i} @ H${i}`, "Points", 20 - i * 0.5, 100 - i));
    scored.push(propLeg(name, `G${i} @ H${i}`, "Rebounds", 19 - i * 0.5, 95 - i));
  });
  for (let i = 0; i < 8; i++) {
    scored.push(mainGame(`M${i} @ N${i}`, 80 - i));
  }

  const six = buildIndependentCoachTicket(scored, 6, { varietySeed: "seed-6" }).picks;
  const fifteen = buildIndependentCoachTicket(scored, 15, { varietySeed: "seed-15" }).picks;
  assert.equal(six.length, 6);
  assert.equal(fifteen.length, 15);
  assert.equal(isPrefixTicket(fifteen, six), false);
});

test("buildIndependentCoachTicket prefers a ticket different from the last build", () => {
  clearParlayVarietyMemory();
  const scored: BoardScoredLeg[] = [];
  for (let i = 0; i < 12; i++) {
    scored.push(propLeg(`Player ${i}`, `G${i} @ H${i}`, "Points", 18 - i * 0.3, 95 - i));
  }
  for (let i = 0; i < 6; i++) {
    scored.push(mainGame(`M${i} @ N${i}`, 70 - i));
  }

  const first = buildIndependentCoachTicket(scored, 6, { varietySeed: "round-1" }).picks;
  rememberParlayBuild(first);

  const second = buildIndependentCoachTicket(scored, 6, {
    varietySeed: "round-2",
    recentTickets: recentParlayTicketLegSets(),
  }).picks;

  assert.ok(second.length >= 3);
  assert.ok(TICKET_CANDIDATE_COUNT >= 5);
  assert.ok(NEAR_EQUAL_TICKET_EDGE_PCT >= 1.5);
  const firstKeys = first.map((p) => parlayLegKey(p));
  const secondKeys = second.map((p) => parlayLegKey(p));
  const overlap = ticketOverlapRatio(secondKeys, firstKeys);
  assert.ok(overlap < 1, `expected at least one fresh leg across builds, overlap=${overlap}`);
});

test("buildStagedTicketFromScan with varietySeed uses independent combinator", () => {
  const scored: BoardScoredLeg[] = [
    propLeg("A", "G1 @ H1", "Points", 20, 100),
    propLeg("B", "G2 @ H2", "Points", 19, 99),
    propLeg("C", "G3 @ H3", "Points", 18, 98),
    mainGame("G4 @ H4", 90),
    mainGame("G5 @ H5", 88),
    mainGame("G6 @ H6", 86),
  ];
  const { picks } = buildStagedTicketFromScan(scored, 3, "combo-seed");
  assert.equal(picks.length, 3);
});
