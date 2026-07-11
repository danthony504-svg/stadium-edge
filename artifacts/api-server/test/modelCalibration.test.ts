import assert from "node:assert/strict";
import { test } from "node:test";

import { computeCalibrationFromGraded } from "../src/lib/modelCalibrationCore.ts";

test("computeCalibrationFromGraded adjusts cold markets down", () => {
  const rows = Array.from({ length: 20 }, (_, i) => ({
    id: String(i),
    sport: "nba",
    game: "A @ B",
    market: "Spread",
    pick: "B -3.5",
    player: null,
    price: -110,
    status: i < 7 ? ("win" as const) : ("loss" as const),
    gradedAt: new Date().toISOString(),
  }));
  const buckets = computeCalibrationFromGraded(rows);
  const spread = buckets.find((b) => b.marketFamily === "spread");
  assert.ok(spread);
  assert.ok(spread!.confidenceDelta < 0);
  assert.equal(spread!.label, "cold");
});
