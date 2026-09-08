import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { ParsedPick } from "./parsedPick.ts";
import {
  fetchCoachCorrelationForBuild,
  resetCoachCorrelationForTests,
  setCoachCorrelationRunnerForTests,
  setCoachCorrelationTimeoutForTests,
} from "./coachCorrelation.ts";
import { resetCoachCorrelationTraceForTests } from "./coachCorrelationTrace.ts";
import {
  beginCoachCorrelationPhase,
  beginCoachFinalizeRequest,
  coachBuildWorkflowIndex,
  getCoachFinalizeRecord,
  markCoachCorrelationComplete,
  markCoachLineValueReady,
} from "./coachFinalize.ts";
import type { BoardScoredLeg } from "./ticketStaging.ts";

function leg(game: string, player: string, edge = 5): BoardScoredLeg {
  const pick: ParsedPick = {
    game,
    market: "Points",
    pick: `${player} Over 20.5 Points`,
    odds: -110,
    isProp: true,
    player,
    propSide: "Over",
    propLine: 20.5,
    sport: "nba",
    finalAiScore: {
      composite: 7,
      grade: "B+",
      confidencePct: 60,
      edgePct: edge,
      simHit: 0.55,
      simAligned: true,
      highRiskValuePlay: false,
      recommends: true,
      factors: [],
      rubric: {
        composite: 7,
        grade: "B+",
        confidencePct: 60,
        edgePct: edge,
        scores: {
          matchup: 7,
          trend: 7,
          lineValue: 7,
          injury: null,
          lineShopping: 7,
          simulation: 7,
        },
      },
    },
  };
  return { pick, rankScore: edge * 10, edgePct: edge };
}

function fiveLegPool(): BoardScoredLeg[] {
  return [
    leg("A @ B", "Player A", 6),
    leg("C @ D", "Player B", 5.5),
    leg("E @ F", "Player C", 5.2),
    leg("G @ H", "Player D", 5.1),
    leg("I @ J", "Player E", 5),
    leg("K @ L", "Player F", 4.8),
  ];
}

describe("coachCorrelation", () => {
  test("normal 5-leg correlation advances workflow past 74%", async () => {
    resetCoachCorrelationForTests();
    resetCoachCorrelationTraceForTests();
    setCoachCorrelationRunnerForTests((input) => ({
      picks: input.scored.slice(0, input.target).map((row) => row.pick),
      breakdown: {
        mainQualified: input.scored.length,
        altQualified: 0,
        mainOnTicket: input.target,
        altOnTicket: 0,
      },
      candidateCount: input.scored.length,
    }));
    beginCoachFinalizeRequest("req-corr-ok", 5);
    markCoachLineValueReady("req-corr-ok");
    beginCoachCorrelationPhase("req-corr-ok");

    const result = await fetchCoachCorrelationForBuild({
      requestId: "req-corr-ok",
      target: 5,
      scored: fiveLegPool(),
      varietySeed: "seed-5",
    });

    assert.equal(result.correlationStatus, "available");
    assert.equal(result.picks.length, 5);
    markCoachCorrelationComplete("req-corr-ok", result.correlationStatus);
    assert.equal(
      coachBuildWorkflowIndex(getCoachFinalizeRecord("req-corr-ok"), null, {
        correlationRecord: result.record,
      }),
      7,
    );
  });

  test("forced correlation timeout continues with ranked picks", async () => {
    resetCoachCorrelationForTests();
    resetCoachCorrelationTraceForTests();
    setCoachCorrelationTimeoutForTests(50);
    setCoachCorrelationRunnerForTests(
      () =>
        new Promise((resolve) => {
          setTimeout(
            () =>
              resolve({
                picks: [],
                breakdown: { mainQualified: 0, altQualified: 0, mainOnTicket: 0, altOnTicket: 0 },
                candidateCount: 0,
              }),
            200,
          );
        }),
    );

    beginCoachFinalizeRequest("req-corr-timeout", 5);
    markCoachLineValueReady("req-corr-timeout");
    beginCoachCorrelationPhase("req-corr-timeout");

    const result = await fetchCoachCorrelationForBuild({
      requestId: "req-corr-timeout",
      target: 5,
      scored: fiveLegPool(),
      varietySeed: "seed-timeout",
    });

    assert.equal(result.correlationStatus, "unavailable");
    assert.ok(result.picks.length > 0, "fallback ranked picks without correlation");
    markCoachCorrelationComplete("req-corr-timeout", "unavailable");
    assert.equal(
      coachBuildWorkflowIndex(getCoachFinalizeRecord("req-corr-timeout"), null, {
        correlationRecord: result.record,
      }),
      7,
    );
  });

  test("empty correlation response finishes without staying at 74%", async () => {
    resetCoachCorrelationForTests();
    setCoachCorrelationRunnerForTests(() => ({
      picks: [],
      breakdown: { mainQualified: 0, altQualified: 0, mainOnTicket: 0, altOnTicket: 0 },
      candidateCount: 0,
    }));

    beginCoachFinalizeRequest("req-corr-empty", 5);
    markCoachLineValueReady("req-corr-empty");
    beginCoachCorrelationPhase("req-corr-empty");

    const result = await fetchCoachCorrelationForBuild({
      requestId: "req-corr-empty",
      target: 5,
      scored: fiveLegPool(),
      varietySeed: "seed-empty",
    });

    assert.equal(result.correlationStatus, "unavailable");
    assert.ok(result.picks.length > 0, "greedy fallback from ranked pool");
    markCoachCorrelationComplete("req-corr-empty", "unavailable");
    assert.equal(
      coachBuildWorkflowIndex(getCoachFinalizeRecord("req-corr-empty"), null, {
        correlationRecord: result.record,
      }),
      7,
    );
  });

  test("duplicate requestId reuses in-flight correlation", async () => {
    resetCoachCorrelationForTests();
    let calls = 0;
    setCoachCorrelationRunnerForTests(async (input) => {
      calls += 1;
      await new Promise((r) => setTimeout(r, 20));
      return {
        picks: input.scored.slice(0, input.target).map((row) => row.pick),
        breakdown: {
          mainQualified: input.scored.length,
          altQualified: 0,
          mainOnTicket: input.target,
          altOnTicket: 0,
        },
        candidateCount: input.scored.length,
      };
    });

    const input = {
      requestId: "req-corr-dedupe",
      target: 5,
      scored: fiveLegPool(),
      varietySeed: "seed-dedupe",
    };
    const [a, b] = await Promise.all([
      fetchCoachCorrelationForBuild(input),
      fetchCoachCorrelationForBuild(input),
    ]);
    assert.equal(calls, 1);
    assert.equal(a.record.requestId, b.record.requestId);
  });
});
