import assert from "node:assert/strict";
import test from "node:test";

import type { ParsedPick } from "./parsedPick.ts";
import {
  buildCoachTicketCacheKey,
  finalizeCoachTicketForRequest,
  recordCoachTicketDelivered,
  rejectPrefixOfLastDelivered,
  startCoachTicketRequest,
  ticketMatchesLargerPrefix,
  varietyContextWithLastDelivered,
  boardScanAppliesToRequest,
} from "./coachRequestLifecycle.ts";
import { boardScanMatchesLegTarget } from "./coachScanPolicy.ts";
import {
  buildIndependentCoachTicket,
  isPrefixTicket,
} from "./coachTicketCombinations.ts";
import { clearParlayVarietyMemory, rememberParlayBuild } from "./parlayVarietyMemory.ts";
import { pickLegFingerprint } from "./parlayReachCore.ts";
import {
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
    propLeg("Allisha Gray", "Sparks @ Dream", "3-Pointers", 18, 90),
    propLeg("Natasha Howard", "Mercury @ Lynx", "Assists", 17, 87),
    propLeg("Allisha Gray", "Sparks @ Dream", "Assists", 17.5, 88),
    propLeg("Jordin Canada", "Sparks @ Dream", "Rebounds", 16.5, 86),
    propLeg("Kahleah Copper", "Mercury @ Lynx", "Pts+Reb", 16, 85),
    propLeg("Ariel Atkins", "Sparks @ Dream", "Rebounds", 15.5, 84),
  ];
  for (let i = 0; i < 14; i++) {
    scored.push(propLeg(`Player ${i}`, `G${i} @ H${i}`, "Points", 15 - i * 0.2, 83 - i));
  }
  return scored;
}

test("cache keys differ by leg count and variety seed", () => {
  const a = buildCoachTicketCacheKey({
    requestedLegs: 15,
    varietySeed: "seed-a",
  });
  const b = buildCoachTicketCacheKey({
    requestedLegs: 4,
    varietySeed: "seed-a",
  });
  const c = buildCoachTicketCacheKey({
    requestedLegs: 4,
    varietySeed: "seed-b",
  });
  assert.notEqual(a, b);
  assert.notEqual(b, c);
});

test("boardScanMatchesLegTarget rejects partial without requestedLegs metadata", () => {
  const partial = { picks: { length: 4 }, scanComplete: false };
  assert.equal(boardScanMatchesLegTarget(partial, 4), false);
});

test("boardScanAppliesToRequest rejects stale requestId", () => {
  const scan = {
    picks: { length: 4 },
    requestedLegs: 4,
    requestId: "req-15",
  };
  assert.equal(boardScanAppliesToRequest(scan, 4, 2, 2, "req-4"), false);
  assert.equal(boardScanAppliesToRequest(scan, 4, 2, 2, "req-15"), true);
});

test("finalizeCoachTicketForRequest rejects prefix then accepts independent ticket", () => {
  clearParlayVarietyMemory();
  const scored = wnbaBoard();
  const fifteen = buildStagedTicketFromScan(scored, 15, "seq-15", {}).picks;
  recordCoachTicketDelivered(fifteen, { requestId: "req-15", requestedLegs: 15 });

  const prefix = fifteen.slice(0, 4);
  const rejected = finalizeCoachTicketForRequest(prefix, {
    requestedLegs: 4,
    requestId: "req-4",
    source: "test-prefix",
  });
  assert.equal(rejected.ok, false);
  if (!rejected.ok) assert.equal(rejected.reason, "prefix-of-last-delivered");

  const ctx = varietyContextWithLastDelivered({
    recentTickets: [],
    recentLeadPlayers: [],
    recentPlayerCounts: new Map(),
    recentTicketsByLegCount: new Map(),
  });
  const independent = buildStagedTicketFromScan(scored, 4, "seq-4", ctx).picks;
  const accepted = finalizeCoachTicketForRequest(independent, {
    requestedLegs: 4,
    requestId: "req-4",
    previousRequestId: "req-15",
    source: "test-independent",
  });
  assert.equal(accepted.ok, true);
  if (accepted.ok) {
    assert.equal(isPrefixTicket(fifteen, accepted.picks), false);
  }
});

test("production sequence: 5-leg then 8-leg must not prefix-match", () => {
  clearParlayVarietyMemory();
  const scored = wnbaBoard();
  const five = buildStagedTicketFromScan(scored, 5, "seq-5", {}).picks;
  recordCoachTicketDelivered(five, { requestId: "req-5", requestedLegs: 5 });
  const ctx = varietyContextWithLastDelivered({
    recentTickets: [],
    recentLeadPlayers: [],
    recentPlayerCounts: new Map(),
    recentTicketsByLegCount: new Map(),
  });
  const eight = buildStagedTicketFromScan(scored, 8, "seq-8", ctx).picks;
  assert.equal(eight.length, 8);
  assert.equal(
    isPrefixTicket(five, eight.slice(0, 5)),
    false,
    `8-leg must not start with exact 5-leg ticket.\n5: ${five.map((p) => pickLegFingerprint(p)).join(",")}\n8-prefix: ${eight.slice(0, 5).map((p) => pickLegFingerprint(p)).join(",")}`,
  );
});

test("production sequence: 15-leg then 4-leg must not prefix-match", () => {
  clearParlayVarietyMemory();
  const scored = wnbaBoard();
  const seed15 = "seq-15";
  const fifteen = buildStagedTicketFromScan(scored, 15, seed15, {}).picks;
  assert.equal(fifteen.length, 15);
  rememberParlayBuild(fifteen);
  recordCoachTicketDelivered(fifteen, {
    requestId: seed15,
    requestedLegs: 15,
  });

  const ctx = varietyContextWithLastDelivered({
    recentTickets: [],
    recentLeadPlayers: [],
    recentPlayerCounts: new Map(),
    recentTicketsByLegCount: new Map(),
  });
  const four = buildStagedTicketFromScan(scored, 4, "seq-4", ctx).picks;
  assert.equal(four.length, 4);
  assert.equal(
    isPrefixTicket(fifteen, four),
    false,
    `4-leg must not match first 4 of 15-leg.\n4: ${four.map((p) => pickLegFingerprint(p)).join(",")}\n15-prefix: ${fifteen.slice(0, 4).map((p) => pickLegFingerprint(p)).join(",")}`,
  );
  assert.equal(rejectPrefixOfLastDelivered(four, 4), false);
});

test("rejectPrefixOfLastDelivered catches exact prefix reuse", () => {
  const larger = Array.from({ length: 15 }, (_, i) => ({
    game: `G${i}`,
    market: "Points",
    pick: `P${i}`,
    odds: -110,
    isProp: true,
    player: `Player ${i}`,
  })) as ParsedPick[];
  recordCoachTicketDelivered(larger, { requestId: "big", requestedLegs: 15 });
  const prefix = larger.slice(0, 4);
  assert.equal(rejectPrefixOfLastDelivered(prefix, 4), true);
  assert.equal(ticketMatchesLargerPrefix(prefix.map((p) => `${p.game}|${p.player}`), larger.map((p) => `${p.game}|${p.player}`)), true);
});

test("startCoachTicketRequest tracks previous request id", () => {
  const first = startCoachTicketRequest({
    requestId: "req-15",
    sendGeneration: 1,
    requestedLegs: 15,
    varietySeed: "seed-15",
  });
  const second = startCoachTicketRequest({
    requestId: "req-4",
    sendGeneration: 2,
    requestedLegs: 4,
    varietySeed: "seed-4",
  });
  assert.equal(second.previousRequestId, first.requestId);
});
