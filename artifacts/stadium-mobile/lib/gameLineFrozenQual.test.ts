import assert from "node:assert/strict";
import test from "node:test";
import { gameLineFrozenMetricsComplete } from "./gameLineFrozenQual.ts";
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
