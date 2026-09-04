import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { COACH_GAME_LINE_EDGE_OVERRIDE_PCT, COACH_LEARNING_MIN_SAMPLE_SIZE } from "@workspace/coach-types";
import type { CoachQualifiedLeg, CoachQualifiedLegPool } from "@workspace/coach-types";

import {
  bestPropEdge,
  computeBaseRankScore,
  passesPropFirstGameLineMargin,
  rankQualifiedPool,
  rankedLegsInTicketOrder,
} from "../src/index";

function leg(
  overrides: Partial<CoachQualifiedLeg> & Pick<CoachQualifiedLeg, "kind" | "pick" | "edgePct">,
): CoachQualifiedLeg {
  return {
    legId: "l1",
    legFingerprint: "fp1",
    sport: "wnba",
    gameId: "g1",
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
      legFingerprint: "fp1",
      sport: "wnba",
      results: [],
      allPassed: true,
      failedGateId: null,
    },
    ...overrides,
  };
}

const pool: CoachQualifiedLegPool = {
  manifest: {
    contextFingerprint: "ctx",
    scanStartedAt: "2026-07-12T20:00:00.000Z",
    scanCompletedAt: "2026-07-12T20:01:00.000Z",
    phase: "complete",
    sports: ["wnba"],
    marketsPosted: 2,
    marketsSeen: 2,
    propsPosted: 1,
    propsSeen: 1,
    gameLinesPosted: 2,
    gameLinesSeen: 2,
    altLinesPosted: 0,
    altLinesSeen: 0,
    candidatesEvaluated: 3,
    simCacheHits: 0,
    simCacheMisses: 3,
    deepSimComplete: true,
    scanComplete: true,
    gatesPassed: 3,
    gatesRejected: 0,
    rejectionBreakdown: {},
  },
  props: [
    leg({
      kind: "player_prop",
      pick: "Over 18.5",
      edgePct: 4.2,
      compositeScore: 78,
      playerName: "A'ja Wilson",
    }),
  ],
  gameLines: [
    leg({
      kind: "game_line",
      pick: "Dallas Wings ML",
      edgePct: -3.0,
      compositeScore: 62,
      grade: "C+",
      confidencePct: 56,
    }),
    leg({
      kind: "game_line",
      pick: "Wings -9.5",
      edgePct: 7.5,
      compositeScore: 80,
      marketKey: "spreads",
      marketLabel: "Spread",
    }),
  ],
};

describe("coach-rank prop-first", () => {
  it("blocks chalk game lines that do not beat best prop edge by 3%", () => {
    assert.equal(bestPropEdge(pool.props), 4.2);
    assert.equal(
      passesPropFirstGameLineMargin(pool.gameLines[0]!, 4.2, COACH_GAME_LINE_EDGE_OVERRIDE_PCT),
      false,
    );

    const ranked = rankQualifiedPool(pool);
    assert.equal(ranked.excludedGameLines.length, 1);
    assert.equal(ranked.excludedGameLines[0]?.pick, "Dallas Wings ML");
    assert.equal(ranked.gameLines.length, 1);
    assert.equal(ranked.gameLines[0]?.pick, "Wings -9.5");
    assert.equal(ranked.gameLineEdgeFloorPct, 4.2 + COACH_GAME_LINE_EDGE_OVERRIDE_PCT);
  });

  it("orders props before eligible game lines for ticket assembly", () => {
    const ranked = rankQualifiedPool(pool);
    const order = rankedLegsInTicketOrder(ranked);
    assert.equal(order.length, 2);
    assert.equal(order[0]?.kind, "player_prop");
    assert.equal(order[1]?.kind, "game_line");
  });

  it("ranks higher edge props above lower edge props", () => {
    const multiPropPool: CoachQualifiedLegPool = {
      ...pool,
      props: [
        leg({ kind: "player_prop", pick: "Over 1.5", edgePct: 3.0, compositeScore: 70 }),
        leg({
          kind: "player_prop",
          pick: "Over 2.5",
          edgePct: 5.5,
          compositeScore: 75,
          legId: "l2",
          legFingerprint: "fp2",
        }),
      ],
      gameLines: [],
    };
    const ranked = rankQualifiedPool(multiPropPool);
    assert.equal(ranked.props[0]?.edgePct, 5.5);
    assert.equal(ranked.props[0]?.rankPosition, 1);
  });

  it("boosts rank score when learning bucket is active", () => {
    const learning = {
      version: 1,
      updatedAt: "2026-01-01T00:00:00.000Z",
      adjustments: [
        {
          sport: "wnba",
          marketKey: "player_points",
          rankWeightMultiplier: 1.25,
          confidenceAdjustmentPct: 3,
          sampleSize: COACH_LEARNING_MIN_SAMPLE_SIZE,
        },
      ],
    };
    const base = computeBaseRankScore(pool.props[0]!);
    const ranked = rankQualifiedPool(pool, { learning });
    assert.ok(ranked.props[0]!.rankScore > base);
    assert.equal(ranked.props[0]!.effectiveConfidencePct, 61);
  });
});
