import assert from "node:assert/strict";
import { test } from "node:test";
import {
  COVERAGE_MATRIX,
  assertNoAccidentalProdReady,
  propPrioritySports,
  rowsForStream,
} from "../src/models/coverageMatrix.js";

test("no coverage row is production-ready", () => {
  assert.doesNotThrow(() => assertNoAccidentalProdReady());
  for (const row of COVERAGE_MATRIX) {
    assert.equal(row.dims.prod, "N");
  }
});

test("football and hockey may mark V2s settle; prod stays N", () => {
  for (const row of COVERAGE_MATRIX) {
    if (row.dims.settle === "V2s") {
      assert.ok(row.stream === "football" || row.stream === "hockey", row.stream);
    }
  }
  assert.ok(rowsForStream("football").length >= 2);
  assert.ok(rowsForStream("hockey").length >= 1);
});

test("prop-priority sports include nfl nba nhl mlb", () => {
  const props = new Set(propPrioritySports());
  for (const s of ["nfl", "ncaaf", "nba", "nhl", "mlb"] as const) {
    assert.ok(props.has(s), `expected prop priority for ${s}`);
  }
});
