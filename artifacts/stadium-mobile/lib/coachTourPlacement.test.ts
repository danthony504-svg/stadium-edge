import test from "node:test";
import assert from "node:assert/strict";
import { placeTourTooltip } from "./coachTourPlacement.ts";
test("Home top search anchor places tour below without overlap", () => {
  assert.deepEqual(placeTourTooltip({ x: 15, y: 100, width: 320, height: 48 }, 844), { top: 164, direction: "below" });
});
test("low screen anchor moves tour above rather than covering tap target", () => {
  assert.deepEqual(placeTourTooltip({ x: 15, y: 650, width: 320, height: 46 }, 844), { top: 349, direction: "above" });
});
test("small screens/offscreen controls safely fall back to unanchored tour", () => {
  assert.equal(placeTourTooltip({ x: 0, y: 220, width: 200, height: 60 }, 420), null);
  assert.equal(placeTourTooltip({ x: 0, y: 900, width: 200, height: 60 }, 800), null);
  assert.equal(placeTourTooltip(null, 800), null);
});
