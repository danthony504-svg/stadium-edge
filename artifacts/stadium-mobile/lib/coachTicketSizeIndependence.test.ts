import assert from "node:assert/strict";
import test from "node:test";

import type { ParsedPick } from "./parsedPick.ts";
import {
  buildIndependentCoachTicket,
  isPrefixTicket,
} from "./coachTicketCombinations.ts";
import {
  boardScanMatchesLegTarget,
  boardScanReadyForDelivery,
} from "./coachScanPolicy.ts";
import { rememberParlayBuild, recentParlayVarietyContext } from "./parlayVarietyMemory.ts";
import { varietyContextWithLastDelivered } from "./coachRequestLifecycle.ts";
import { pickLegFingerprint } from "./parlayReachCore.ts";
import {
  buildBalancedStagedTicketFromScan,
  buildStagedTicketFromScan,
  type BoardScoredLeg,
} from "./ticketStaging.ts";

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
      pick: `${player} pick`,
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

function wnbaBoard(): BoardScoredLeg[] {
  const scored: BoardScoredLeg[] = [
    propLeg("Allisha Gray", "Sparks @ Dream", "Assists", 18, 90),
    propLeg("Allisha Gray", "Sparks @ Dream", "3-Pointers", 17.5, 88),
    propLeg("Natasha Howard", "Mercury @ Lynx", "Assists", 17, 87),
    propLeg("Jordin Canada", "Sparks @ Dream", "Rebounds", 16.5, 86),
    propLeg("Kahleah Copper", "Mercury @ Lynx", "Pts+Reb", 16, 85),
    propLeg("Ariel Atkins", "Sparks @ Dream", "Rebounds", 15.5, 84),
  ];
  for (let i = 0; i < 14; i++) {
    scored.push(propLeg(`Player ${i}`, `G${i} @ H${i}`, "Points", 15 - i * 0.2, 83 - i));
  }
  return scored;
}

export function pickIds(picks: ParsedPick[]): string[] {
  return picks.map((p) => pickLegFingerprint(p));
}

test("boardScanReadyForDelivery rejects 15-leg scan for 8-leg ask", () => {
  const fifteen = {
    scanComplete: true,
    requestedLegs: 15,
    picks: Array.from({ length: 15 }),
  };
  assert.equal(boardScanReadyForDelivery(fifteen, 8), false);
  assert.equal(boardScanMatchesLegTarget(fifteen, 8), false);
});

test("production sequence: 15-leg then 4-leg must not prefix-match", () => {
  const scored = wnbaBoard();
  const seed = "sequence-15-then-4";
  const fifteen = buildIndependentCoachTicket(scored, 15, { varietySeed: seed }).picks;
  rememberParlayBuild(fifteen);
  const ctx = varietyContextWithLastDelivered(recentParlayVarietyContext());
  const four = buildStagedTicketFromScan(scored, 4, "sequence-4", ctx).picks;
  assert.equal(four.length, 4);
  assert.equal(isPrefixTicket(fifteen, four), false);
});

test("production sequence: 8-leg must not prefix-match first 8 of 15-leg (independent combinator)", () => {
  const scored = wnbaBoard();
  const seed = "sequence-test-seed";
  const eight = buildIndependentCoachTicket(scored, 8, { varietySeed: seed }).picks;
  const fifteen = buildIndependentCoachTicket(scored, 15, { varietySeed: seed }).picks;
  assert.equal(eight.length, 8);
  assert.equal(fifteen.length, 15);
  assert.equal(
    isPrefixTicket(fifteen, eight),
    false,
    `8-leg pick IDs must not match first 8 of 15-leg.\n8: ${pickIds(eight).join(",")}\n15: ${pickIds(fifteen).slice(0, 8).join(",")}`,
  );
});

test("buildStagedTicketFromScan must use independent combinator — not balanced greedy prefix", () => {
  const scored = wnbaBoard();
  const seed = "staged-scan-seed";
  const eight = buildStagedTicketFromScan(scored, 8, seed, {}).picks;
  const fifteen = buildStagedTicketFromScan(scored, 15, seed, {}).picks;
  assert.equal(isPrefixTicket(fifteen, eight), false);
});

test("buildBalancedStagedTicketFromScan may differ by size — not relied on for 3+ leg builds", () => {
  const scored = wnbaBoard();
  const seed = "balanced-legacy";
  const eight = buildBalancedStagedTicketFromScan(scored, 8, seed).picks;
  const fifteen = buildBalancedStagedTicketFromScan(scored, 15, seed).picks;
  assert.equal(eight.length, 8);
  assert.equal(fifteen.length, 15);
});
