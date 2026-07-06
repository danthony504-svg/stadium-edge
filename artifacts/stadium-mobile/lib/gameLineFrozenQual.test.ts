import assert from "node:assert/strict";
import test from "node:test";
import {
  assertGameLineFinalizeMetrics,
  assertSub50GameLineQualificationExplained,
  explainGameLineQualification,
  gameLineFrozenMetricsComplete,
  gameLineSimEdgeQualifies,
  GameLineFinalizeRejected,
  GAME_LINE_EXCEPTIONAL_EDGE_PCT,
} from "./gameLineFrozenQual.ts";
import type { ParsedPick } from "../components/PickCard.tsx";

function mockFrozen(overrides?: Partial<NonNullable<ParsedPick["gameLineFinal"]>["display"]>): ParsedPick {
  const display = {
    pick: "Angels +1.5",
    market: "Spread",
    odds: -110,
    game: "Boston Red Sox @ Los Angeles Angels",
    grade: "B+",
    confidencePct: 55,
    edgePct: 3.2,
    evPct: 4.1,
    simHit: 0.54,
    simPct: 54,
    ...overrides,
  };
  return {
    game: display.game,
    market: display.market,
    pick: display.pick,
    odds: display.odds,
    isProp: false,
    gameLineFrozen: true,
    gameLineFinal: {
      reason: "test",
      finalScore: 6.8,
      frozenAt: 1,
      display,
    },
  };
}

test("gameLineFrozenMetricsComplete requires every frozen display field", () => {
  assert.equal(gameLineFrozenMetricsComplete(mockFrozen()), true);
  assert.equal(gameLineFrozenMetricsComplete(mockFrozen({ edgePct: null })), false);
  assert.equal(gameLineFrozenMetricsComplete(mockFrozen({ grade: "—" })), false);
  assert.equal(gameLineFrozenMetricsComplete(mockFrozen({ grade: "C-" })), false);
  assert.equal(gameLineFrozenMetricsComplete(mockFrozen({ confidencePct: 49 })), false);
});

test("gameLineFrozenMetricsComplete rejects unfrozen picks", () => {
  const pick = mockFrozen();
  pick.gameLineFrozen = false;
  assert.equal(gameLineFrozenMetricsComplete(pick), false);
});

test("assertGameLineFinalizeMetrics rejects sim 49% with missing edge", () => {
  const pick = mockFrozen({ simHit: 0.49, simPct: 49, edgePct: undefined as unknown as number });
  assert.throws(
    () =>
      assertGameLineFinalizeMetrics(pick, {
        grade: "B+",
        confidencePct: 55,
        simHit: 0.49,
        edgePct: null,
        market: "Spread",
        odds: -110,
      }),
    GameLineFinalizeRejected,
  );
});

test("assertGameLineFinalizeMetrics rejects sim 49% with edge below 4.5%", () => {
  const pick = mockFrozen({ simHit: 0.49, simPct: 49, edgePct: 2.1 });
  assert.throws(
    () =>
      assertGameLineFinalizeMetrics(pick, {
        grade: "B+",
        confidencePct: 55,
        simHit: 0.49,
        edgePct: 2.1,
        market: "Spread",
        odds: -110,
      }),
    GameLineFinalizeRejected,
  );
});

test("assertGameLineFinalizeMetrics accepts sim 49% with exceptional edge", () => {
  const pick = mockFrozen({ simHit: 0.49, simPct: 49, edgePct: 5.1, evPct: 6 });
  assert.doesNotThrow(() =>
    assertGameLineFinalizeMetrics(pick, {
      grade: "B+",
      confidencePct: 55,
      simHit: 0.49,
      edgePct: 5.1,
      evPct: 6,
      market: "Spread",
      odds: -110,
    }),
  );
});

test("gameLineSimEdgeQualifies enforces exceptional edge under 50% sim", () => {
  assert.equal(gameLineSimEdgeQualifies(0.49, 2), false);
  assert.equal(gameLineSimEdgeQualifies(0.49, GAME_LINE_EXCEPTIONAL_EDGE_PCT), true);
  assert.equal(gameLineSimEdgeQualifies(0.52, 1.2), true);
});

test("explainGameLineQualification logs exceptional_edge for sub-50% sim", () => {
  const pick = mockFrozen({ simHit: 0.49, simPct: 49, edgePct: 5.1, evPct: 6 });
  const reason = explainGameLineQualification(pick);
  assert.equal(reason.path, "exceptional_edge");
  assert.equal(reason.exceptional_edge, true);
  assert.equal(reason.simPct, 49);
  assert.match(reason.summary, /exceptional edge 5\.1%/);
});

test("explainGameLineQualification logs sim_at_50_strong_ev", () => {
  const pick = mockFrozen({ simHit: 0.5, simPct: 50, edgePct: 2.2, evPct: 4.5 });
  const reason = explainGameLineQualification(pick);
  assert.equal(reason.path, "sim_at_50_strong_ev");
  assert.equal(reason.strong_ev, true);
});

test("assertSub50GameLineQualificationExplained rejects 49% without exceptional edge", () => {
  const pick = mockFrozen({ simHit: 0.49, simPct: 49, edgePct: 2.1, evPct: 2.5 });
  assert.throws(
    () => assertSub50GameLineQualificationExplained(pick),
    /exceptional_edge|does not meet any qualification path/,
  );
});
