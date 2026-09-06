import assert from "node:assert/strict";
import test from "node:test";

import type { ParsedPick } from "../components/PickCard.tsx";
import {
  buildIndependentCoachTicket,
  isPrefixTicket,
  NEAR_EQUAL_TICKET_EDGE_PCT,
  TICKET_CANDIDATE_COUNT,
} from "./coachTicketCombinations.ts";
import {
  clearParlayVarietyMemory,
  parlayLegKey,
  parlayPlayerKey,
  rememberParlayBuild,
  recentParlayVarietyContext,
  ticketOverlapRatio,
} from "./parlayVarietyMemory.ts";
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

test("market-agnostic ticket gives every qualified family a selection opportunity", () => {
  const gameLeg = (market: string, pick: string, rank: number): BoardScoredLeg => ({
    ...mainGame(`${market} Away @ Home`, rank),
    pick: {
      ...mainGame(`${market} Away @ Home`, rank).pick,
      market,
      pick,
    },
  });
  const scored: BoardScoredLeg[] = [
    propLeg("Prop Star", "Props Away @ Home", "Points", 18, 100),
    gameLeg("Moneyline", "Away ML", 99),
    gameLeg("Spread", "Away +1.5", 98),
    gameLeg("Game Total", "Over 8.5", 97),
    gameLeg("Team Total", "Away Over 3.5", 96),
    gameLeg("Alt Total", "Under 9.5", 95),
  ];

  const { picks, familyVariety } = buildIndependentCoachTicket(scored, 6, {
    varietySeed: "family-coverage",
    marketAgnostic: true,
  });

  assert.equal(picks.length, 6);
  assert.deepEqual(familyVariety.qualifiedByFamily, {
    moneyline: 1, spread: 1, gameTotal: 1, teamTotal: 1,
    playerOu: 0, milestone: 1, alternate: 1,
  });
  assert.deepEqual(familyVariety.selectedByFamily, familyVariety.qualifiedByFamily);
  assert.deepEqual(familyVariety.skippedFamilies, []);
});

test("generic six-leg market-agnostic tickets reserve a qualified player prop", () => {
  const gameLeg = (market: string, rank: number): BoardScoredLeg => ({
    ...mainGame(`${market} Away @ Home`, rank),
    pick: {
      ...mainGame(`${market} Away @ Home`, rank).pick,
      market,
      pick: `${market} selection`,
    },
  });
  const scored: BoardScoredLeg[] = [
    propLeg("Qualified Prop", "Prop Away @ Home", "Points", 12, 80),
    gameLeg("Moneyline", 100),
    gameLeg("Spread", 99),
    gameLeg("Game Total", 98),
    gameLeg("Team Total", 97),
    gameLeg("Alt Total", 96),
    gameLeg("Alt Spread", 95),
  ];
  const { picks } = buildIndependentCoachTicket(scored, 6, {
    varietySeed: "generic-six-prop-floor",
    marketAgnostic: true,
  });

  assert.equal(picks.length, 6);
  assert.ok(picks.some((pick) => pick.isProp), "a qualified player prop must survive family coverage");
});

test("explicit mix reserves qualified player-prop and game-line slots", () => {
  const scored: BoardScoredLeg[] = [
    propLeg("Prop One", "A @ B", "Points", 15, 100),
    propLeg("Prop Two", "C @ D", "Rebounds", 14, 99),
    ...[0, 1, 2, 3].map((index) => mainGame(`G${index} @ H${index}`, 98 - index)),
  ];
  const { picks, familyVariety } = buildIndependentCoachTicket(scored, 6, {
    varietySeed: "explicit-two-and-two",
    marketAgnostic: true,
    mixConstraints: { minPlayerProps: 2, minGameLines: 2 },
  });
  assert.equal(picks.filter((pick) => pick.isProp).length >= 2, true);
  assert.equal(picks.filter((pick) => !pick.isProp).length >= 2, true);
  assert.equal(familyVariety.composition?.compositionShortfallReason, null);
});

test("explicit mix reports an honest player-prop shortfall without unqualified filler", () => {
  const scored: BoardScoredLeg[] = [
    propLeg("Only Prop", "A @ B", "Points", 15, 100),
    ...[0, 1, 2, 3, 4].map((index) => mainGame(`G${index} @ H${index}`, 98 - index)),
  ];
  const { picks, familyVariety } = buildIndependentCoachTicket(scored, 6, {
    varietySeed: "prop-shortfall",
    marketAgnostic: true,
    mixConstraints: { minPlayerProps: 2, minGameLines: 2 },
  });
  assert.equal(picks.filter((pick) => pick.isProp).length, 1);
  assert.match(familyVariety.composition?.compositionShortfallReason ?? "", /only 1 qualified/i);
});

test("explicit mix reports an honest game-line shortfall without altering a normal ticket", () => {
  const scored: BoardScoredLeg[] = [
    ...[0, 1, 2, 3, 4].map((index) => propLeg(`Prop ${index}`, `P${index} @ Q${index}`, "Points", 15, 100 - index)),
    mainGame("Only Game @ Opponent", 90),
  ];
  const constrained = buildIndependentCoachTicket(scored, 6, {
    varietySeed: "game-shortfall",
    marketAgnostic: true,
    mixConstraints: { minPlayerProps: 2, minGameLines: 2 },
  });
  const unconstrained = buildIndependentCoachTicket(scored, 6, {
    varietySeed: "game-shortfall",
    marketAgnostic: true,
  });
  assert.equal(constrained.picks.filter((pick) => !pick.isProp).length, 1);
  assert.match(constrained.familyVariety.composition?.compositionShortfallReason ?? "", /only 1 qualified/i);
  assert.equal(unconstrained.familyVariety.composition?.requestedMinGameLines, 0);
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

  const sharedSeed = "shared-board-seed";
  const five = buildIndependentCoachTicket(scored, 5, { varietySeed: sharedSeed }).picks;
  const six = buildIndependentCoachTicket(scored, 6, { varietySeed: sharedSeed }).picks;
  const fifteen = buildIndependentCoachTicket(scored, 15, { varietySeed: sharedSeed }).picks;
  assert.equal(five.length, 5);
  assert.equal(six.length, 6);
  assert.equal(fifteen.length, 15);
  assert.equal(isPrefixTicket(fifteen, five), false, "5-leg must not be a prefix of 15-leg");
  assert.equal(isPrefixTicket(fifteen, six), false, "6-leg must not be a prefix of 15-leg");
  assert.equal(isPrefixTicket(six, five), false, "5-leg must not be a prefix of 6-leg");
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

  const ctx = recentParlayVarietyContext();
  const second = buildIndependentCoachTicket(scored, 6, {
    varietySeed: "round-2",
    ...ctx,
  }).picks;

  assert.ok(second.length >= 3);
  assert.ok(TICKET_CANDIDATE_COUNT >= 25);
  assert.ok(NEAR_EQUAL_TICKET_EDGE_PCT >= 1.5);
  const firstKeys = first.map((p) => parlayLegKey(p));
  const secondKeys = second.map((p) => parlayLegKey(p));
  const overlap = ticketOverlapRatio(secondKeys, firstKeys);
  assert.ok(overlap < 1, `expected at least one fresh leg across builds, overlap=${overlap}`);
});

test("buildIndependentCoachTicket rotates anchor player after repeated lead picks", () => {
  clearParlayVarietyMemory();
  const scored: BoardScoredLeg[] = [
    propLeg("Allisha Gray", "Sparks @ Dream", "Assists", 18, 90),
    propLeg("Natasha Howard", "Mercury @ Lynx", "Assists", 17.8, 89),
    propLeg("Jordin Canada", "Sparks @ Dream", "Rebounds", 17.6, 88),
    propLeg("Kahleah Copper", "Mercury @ Lynx", "Pts+Reb", 17.4, 87),
    propLeg("Player Five", "A @ B", "Points", 17.2, 86),
    propLeg("Player Six", "C @ D", "Points", 17, 85),
    mainGame("E @ F", 70),
    mainGame("G @ H", 68),
    mainGame("I @ J", 66),
  ];

  for (let i = 0; i < 3; i++) {
    const ticket = buildIndependentCoachTicket(scored, 5, {
      varietySeed: `anchor-round-${i}`,
      ...recentParlayVarietyContext(),
    }).picks;
    rememberParlayBuild(ticket);
  }

  const fourth = buildIndependentCoachTicket(scored, 5, {
    varietySeed: "anchor-round-4",
    ...recentParlayVarietyContext(),
  }).picks;
  const recentLeads = recentParlayVarietyContext().recentLeadPlayers;
  const grayLeads = recentLeads.filter((p) => p === parlayPlayerKey({ player: "Allisha Gray" })).length;
  const fourthLead = parlayPlayerKey(fourth[0] ?? {});
  assert.ok(
    fourthLead !== parlayPlayerKey({ player: "Allisha Gray" }) || grayLeads < 3,
    "expected anchor rotation away from repeatedly featured lead player",
  );
});

test("5-leg WNBA ticket is not the opening legs of a 15-leg ticket on the same board", () => {
  const scored: BoardScoredLeg[] = [
    propLeg("Allisha Gray", "Sparks @ Dream", "Assists", 18, 90),
    propLeg("Allisha Gray", "Sparks @ Dream", "3-Pointers", 17.5, 88),
    propLeg("Natasha Howard", "Mercury @ Lynx", "Assists", 17, 87),
    propLeg("Jordin Canada", "Sparks @ Dream", "Rebounds", 16.5, 86),
    propLeg("Kahleah Copper", "Mercury @ Lynx", "Pts+Reb", 16, 85),
    propLeg("Ariel Atkins", "Sparks @ Dream", "Rebounds", 15.5, 84),
    propLeg("Player Seven", "A @ B", "Points", 15, 83),
    propLeg("Player Eight", "C @ D", "Points", 14.5, 82),
    propLeg("Player Nine", "E @ F", "Points", 14, 81),
    propLeg("Player Ten", "G @ H", "Points", 13.5, 80),
    mainGame("I @ J", 70),
    mainGame("K @ L", 68),
    mainGame("M @ N", 66),
    mainGame("O @ P", 64),
    mainGame("Q @ R", 62),
  ];
  const seed = "wnba-live-board";
  const five = buildIndependentCoachTicket(scored, 5, { varietySeed: seed }).picks;
  const fifteen = buildIndependentCoachTicket(scored, 15, { varietySeed: seed }).picks;
  assert.equal(isPrefixTicket(fifteen, five), false);
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
