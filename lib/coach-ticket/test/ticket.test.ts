import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { CoachQualifiedLegPool, CoachScanManifest } from "@workspace/coach-types";
import { rankQualifiedPool } from "@workspace/coach-rank";
import type { CoachRankedLeg } from "@workspace/coach-rank";

import {
  assembleCoachTicket,
  assembleCoachTicketResponse,
  assertTicketInvariants,
  buildShortfallReason,
  canAddLegToTicket,
  selectTicketLegs,
  toPickDisplay,
  topRejectionReasons,
} from "../src/index";

function manifest(overrides: Partial<CoachScanManifest> = {}): CoachScanManifest {
  return {
    contextFingerprint: "ctx",
    scanStartedAt: "2026-07-12T20:00:00.000Z",
    scanCompletedAt: "2026-07-12T20:01:00.000Z",
    phase: "complete",
    sports: ["wnba", "mlb"],
    marketsPosted: 12,
    marketsSeen: 12,
    propsPosted: 8,
    propsSeen: 8,
    gameLinesPosted: 4,
    gameLinesSeen: 4,
    altLinesPosted: 2,
    altLinesSeen: 2,
    candidatesEvaluated: 14,
    simCacheHits: 3,
    simCacheMisses: 11,
    deepSimComplete: true,
    scanComplete: true,
    gatesPassed: 5,
    gatesRejected: 9,
    rejectionBreakdown: {
      positive_edge: 4,
      simulation: 3,
      confidence: 2,
    },
    ...overrides,
  };
}

function leg(
  overrides: Partial<CoachRankedLeg> &
    Pick<CoachRankedLeg, "kind" | "pick" | "edgePct" | "gameId">,
): CoachRankedLeg {
  return {
    legId: `l-${overrides.pick}`,
    legFingerprint: `fp:${overrides.pick}`,
    sport: "wnba",
    gameLabel: "Chicago Sky @ Dallas Wings",
    marketKey: overrides.kind === "player_prop" ? "player_points" : "h2h",
    marketLabel: overrides.kind === "player_prop" ? "Points" : "Moneyline",
    odds: -110,
    line: overrides.kind === "player_prop" ? 18.5 : null,
    startsAt: "2026-07-12T22:00:00.000Z",
    isAlt: false,
    simHitPct: 56,
    evPct: 4,
    confidencePct: 58,
    compositeScore: 72,
    grade: "B",
    gateEvaluation: {
      legFingerprint: `fp:${overrides.pick}`,
      sport: "wnba",
      results: [],
      allPassed: true,
      failedGateId: null,
    },
    rankScore: 80,
    rankPosition: 1,
    learningMultiplier: 1,
    confidenceAdjustmentPct: 0,
    effectiveConfidencePct: 58,
    ...overrides,
  };
}

function rankedPoolFromLegs(legs: CoachRankedLeg[]) {
  const props = legs.filter((l) => l.kind === "player_prop");
  const gameLines = legs.filter((l) => l.kind === "game_line");
  return {
    props,
    gameLines,
    excludedGameLines: [],
    bestPropEdgePct: props.length ? Math.max(...props.map((p) => p.edgePct)) : null,
    gameLineEdgeFloorPct: null,
  };
}

describe("coach-ticket selection", () => {
  it("enforces one leg per game and one prop per player", () => {
    const legs = [
      leg({ kind: "player_prop", pick: "Over 18.5", edgePct: 5, gameId: "g1", playerId: "p1", playerName: "A" }),
      leg({ kind: "player_prop", pick: "Over 22.5", edgePct: 4.5, gameId: "g2", playerId: "p2", playerName: "B" }),
      leg({ kind: "player_prop", pick: "Over 12.5", edgePct: 4, gameId: "g1", playerId: "p3", playerName: "C" }),
      leg({ kind: "game_line", pick: "Sky ML", edgePct: 3.5, gameId: "g3" }),
    ];

    assert.equal(canAddLegToTicket([], legs[0]!), true);
    assert.equal(canAddLegToTicket([legs[0]!], legs[2]!), false);
    assert.equal(canAddLegToTicket([legs[0]!], legs[1]!), true);

    const { picks, droppedForDiversity } = selectTicketLegs(legs, 4);
    assert.equal(picks.length, 3);
    assert.equal(droppedForDiversity, 1);
    assert.equal(new Set(picks.map((p) => p.gameId)).size, picks.length);
  });

  it("returns fewer than target when pool is exhausted — no filler", () => {
    const legs = [
      leg({ kind: "player_prop", pick: "Over 18.5", edgePct: 5, gameId: "g1", playerId: "p1", rankScore: 90 }),
      leg({ kind: "player_prop", pick: "Over 22.5", edgePct: 4.5, gameId: "g2", playerId: "p2", rankScore: 85 }),
    ];
    const { picks } = selectTicketLegs(legs, 9);
    assert.equal(picks.length, 2);
  });
});

describe("coach-ticket assembly", () => {
  const pool: CoachQualifiedLegPool = {
    manifest: manifest(),
    props: [
      leg({
        kind: "player_prop",
        pick: "Over 18.5",
        edgePct: 4.2,
        gameId: "g1",
        playerId: "p1",
        playerName: "Wilson",
        rankScore: 88,
      }),
      leg({
        kind: "player_prop",
        pick: "Over 1.5",
        edgePct: 3.8,
        gameId: "g2",
        playerId: "p2",
        playerName: "Judge",
        sport: "mlb",
        rankScore: 82,
      }),
      leg({
        kind: "player_prop",
        pick: "Over 2.5",
        edgePct: 5.2,
        gameId: "g2",
        playerId: "p2",
        playerName: "Judge",
        sport: "mlb",
        isAlt: true,
        rankScore: 78,
      }),
    ],
    gameLines: [
      leg({
        kind: "game_line",
        pick: "Sky ML",
        edgePct: 8.5,
        gameId: "g3",
        rankScore: 70,
      }),
    ],
  };

  it("assembles a full ticket with one champion per alt ladder", () => {
    const ranked = rankQualifiedPool(pool);
    const ticket = assembleCoachTicket({
      ranked,
      manifest: pool.manifest,
      requestedLegs: 3,
      nowMs: Date.parse("2026-07-12T21:00:00.000Z"),
    });

    assert.equal(ticket.requestedLegs, 3);
    assert.equal(ticket.deliveredLegs, 3);
    assert.equal(ticket.picks.length, 3);
    assert.equal(ticket.propCount, 2);
    assert.equal(ticket.gameLineCount, 1);
    assert.ok(ticket.picks.every((p) => p.edgePct > 0));
    assert.equal(ticket.picks.some((p) => p.pick === "Over 2.5"), false);
    assertTicketInvariants(ticket);
  });

  it("returns honest partial ticket with shortfall when legs are insufficient", () => {
    const ranked = rankQualifiedPool(pool);
    const response = assembleCoachTicketResponse({
      ranked,
      manifest: pool.manifest,
      requestedLegs: 9,
      nowMs: Date.parse("2026-07-12T21:00:00.000Z"),
    });

    assert.equal(response.ticket.requestedLegs, 9);
    assert.equal(response.ticket.deliveredLegs, 3);
    assert.ok(response.shortfall);
    assert.equal(response.shortfall?.code, "insufficient_qualified_legs");
    assert.equal(response.shortfall?.requestedLegs, 9);
    assert.equal(response.shortfall?.deliveredLegs, 3);
    assert.match(response.shortfall!.message, /Only 3 legs passed all AI gates/);
    assert.match(response.shortfall!.message, /No filler picks added/);
    assert.equal(response.ready, true);
    assertTicketInvariants(response.ticket);
  });

  it("filters by sport when sportFilter is set", () => {
    const ranked = rankQualifiedPool(pool);
    const ticket = assembleCoachTicket({
      ranked,
      manifest: pool.manifest,
      requestedLegs: 5,
      sportFilter: "mlb",
    });

    assert.ok(ticket.picks.every((p) => p.sport === "mlb"));
    assert.equal(ticket.deliveredLegs, 1);
  });

  it("rejects tickets with non-positive edge via invariant check", () => {
    const badTicket = assembleCoachTicket({
      ranked: rankedPoolFromLegs([
        leg({ kind: "game_line", pick: "Wings ML", edgePct: -3, gameId: "g9" }),
      ]),
      manifest: manifest(),
      requestedLegs: 3,
    });

    assert.throws(
      () => assertTicketInvariants(badTicket),
      /non-positive edge pick: Wings ML/,
    );
  });
});

describe("coach-ticket shortfall", () => {
  it("surfaces top rejection reasons from manifest", () => {
    const m = manifest();
    const top = topRejectionReasons(m, 2);
    assert.equal(top.length, 2);
    assert.equal(top[0]?.reason, "positive_edge");
    assert.equal(top[0]?.count, 4);

    const shortfall = buildShortfallReason(m, 9, 3, 2, 1);
    assert.equal(shortfall.propsQualified, 2);
    assert.equal(shortfall.gameLinesQualified, 1);
    assert.equal(shortfall.topRejections.length, 2);
  });
});

describe("coach-ticket display", () => {
  it("maps ranked leg fields to pick display", () => {
    const ranked = leg({
      kind: "player_prop",
      pick: "Over 18.5",
      edgePct: 4.2,
      gameId: "g1",
      playerId: "p1",
      playerName: "Wilson",
      effectiveConfidencePct: 61,
    });
    const display = toPickDisplay(ranked);
    assert.equal(display.game, ranked.gameLabel);
    assert.equal(display.isProp, true);
    assert.equal(display.player, "Wilson");
    assert.equal(display.confidencePct, 61);
    assert.equal(display.edgePct, 4.2);
  });
});
