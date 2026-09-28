import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { computeLegFingerprint } from "@workspace/coach-data";
import { createMlbAdapter } from "@workspace/coach-data/sports";
import type { CoachCandidateLeg, CoachSimResult, CoachSportContext } from "@workspace/coach-types";

import {
  evaluateCoachGates,
  summarizeRejectionBreakdown,
  matchupAlignment,
  type CoachGateEvaluationContext,
} from "../src/index";

const adapter = createMlbAdapter();

const baseFingerprint = computeLegFingerprint({
  sport: "mlb",
  gameId: "g1",
  marketKey: "batter_hits",
  pick: "Over 1.5",
  line: 1.5,
  odds: -110,
  playerId: "p1",
  isAlt: false,
});

const baseCandidate: CoachCandidateLeg = {
  legId: "g1:prop:hits",
  legFingerprint: baseFingerprint,
  kind: "player_prop",
  sport: "mlb",
  gameId: "g1",
  gameLabel: "NYY @ BOS",
  marketKey: "batter_hits",
  marketLabel: "Hits",
  pick: "Over 1.5",
  odds: -110,
  line: 1.5,
  startsAt: "2026-07-12T23:00:00.000Z",
  isAlt: false,
  playerId: "p1",
  playerName: "Aaron Judge",
  propSide: "Over",
};

const passingSim: CoachSimResult = {
  legFingerprint: baseFingerprint,
  tier: "deep",
  iterations: 10_000,
  hitProbability: 0.56,
  evPct: 4.2,
  edgePct: 3.1,
  distributionSummary: { confidenceScore: 58 },
  computedAt: "2026-07-12T20:00:00.000Z",
};

const passingContext: CoachGateEvaluationContext = {
  trends: { momentum: 0.2, sampleSize: 5 },
  injuries: { favor: 0.1 },
  lineMovement: { direction: "neutral" },
};

const sportContext: CoachSportContext = {
  sport: "mlb",
  injuries: {},
  matchupHistory: {},
  playerHistory: {},
  lineMovement: {},
  trends: {},
};

function evaluate(
  overrides: {
    candidate?: CoachCandidateLeg;
    sim?: CoachSimResult | null;
    context?: CoachGateEvaluationContext;
  } = {},
) {
  return evaluateCoachGates({
    candidate: overrides.candidate ?? baseCandidate,
    sim: overrides.sim === undefined ? passingSim : overrides.sim,
    context: overrides.context ?? passingContext,
    adapter,
    sportContext,
  });
}

describe("coach-gates helpers", () => {
  it("detects pick against mlLean", () => {
    const { aligned } = matchupAlignment({ side: "Yankees", edge: 2.5 }, "Red Sox");
    assert.equal(aligned, -1);
  });
});

describe("coach-gates pipeline", () => {
  it("passes all 10 gates for a qualified prop", () => {
    const result = evaluate();
    assert.equal(result.allPassed, true);
    assert.equal(result.failedGateId, null);
    assert.equal(result.results.length, 10);
    assert.ok(result.results.every((r) => r.pass));
  });

  it("stops at simulation gate when sim is missing", () => {
    const result = evaluate({ sim: null });
    assert.equal(result.allPassed, false);
    assert.equal(result.failedGateId, "simulation");
    assert.equal(result.results.length, 1);
    assert.equal(result.results[0]?.reasonCode, "sim_incomplete");
  });

  it("stops at positive_ev when EV is not positive", () => {
    const result = evaluate({
      sim: { ...passingSim, evPct: -1.2, edgePct: 2.0 },
    });
    assert.equal(result.failedGateId, "positive_ev");
    assert.equal(result.results.length, 2);
  });

  it("stops at positive_edge when edge is not positive", () => {
    const result = evaluate({
      sim: { ...passingSim, evPct: 1.0, edgePct: -2.1 },
    });
    assert.equal(result.failedGateId, "positive_edge");
    assert.equal(result.results.length, 3);
  });

  it("stops at confidence when below threshold", () => {
    const result = evaluate({
      sim: {
        ...passingSim,
        distributionSummary: { confidenceScore: 48 },
      },
    });
    assert.equal(result.failedGateId, "confidence_threshold");
    assert.equal(result.results.length, 4);
  });

  it("fails closed when trend sample is insufficient", () => {
    const result = evaluate({
      context: {
        ...passingContext,
        trends: { momentum: 0.5, sampleSize: 1 },
      },
    });
    assert.equal(result.failedGateId, "trends");
    assert.equal(result.results.find((r) => r.gateId === "trends")?.reasonCode, "trends_insufficient_sample");
  });

  it("fails closed when injury data is missing", () => {
    const result = evaluate({
      context: {
        ...passingContext,
        injuries: undefined,
      },
    });
    assert.equal(result.failedGateId, "injuries");
  });

  it("fails when line moved against the pick", () => {
    const result = evaluate({
      context: {
        ...passingContext,
        lineMovement: { direction: "against", magnitudePct: 1.5 },
      },
    });
    assert.equal(result.failedGateId, "line_movement");
  });

  it("applies same gates to alt lines", () => {
    const altCandidate: CoachCandidateLeg = {
      ...baseCandidate,
      isAlt: true,
      pick: "Over 2.5",
      line: 2.5,
      odds: +140,
      legFingerprint: computeLegFingerprint({
        sport: "mlb",
        gameId: "g1",
        marketKey: "batter_hits",
        pick: "Over 2.5",
        line: 2.5,
        odds: 140,
        playerId: "p1",
        isAlt: true,
      }),
    };
    const result = evaluate({ candidate: altCandidate });
    assert.equal(result.allPassed, true);
  });

  it("fails game-line pick that opposes mlLean", () => {
    const gameCandidate: CoachCandidateLeg = {
      ...baseCandidate,
      kind: "game_line",
      marketKey: "h2h",
      marketLabel: "Moneyline",
      pick: "Boston Red Sox ML",
      line: null,
      propSide: undefined,
      playerId: null,
      playerName: null,
    };
    const result = evaluate({
      candidate: gameCandidate,
      context: {
        ...passingContext,
        matchup: {
          pickTeam: "Boston Red Sox",
          mlLean: { side: "New York Yankees", edge: 2.0 },
        },
      },
    });
    assert.equal(result.failedGateId, "matchup");
  });

  it("summarizes rejection breakdown by reason code", () => {
    const a = evaluate({ sim: null });
    const b = evaluate({
      sim: { ...passingSim, evPct: -1, edgePct: 1 },
    });
    const breakdown = summarizeRejectionBreakdown([a, b]);
    assert.equal(breakdown.sim_incomplete, 1);
    assert.equal(breakdown.ev_not_positive, 1);
  });
});
