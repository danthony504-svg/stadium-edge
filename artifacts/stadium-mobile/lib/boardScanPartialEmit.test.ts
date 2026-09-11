import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

/**
 * Mirrors boardMarketScanner.shouldEmitBoardScanPartial — kept inline so this
 * file does not import the heavy scanner graph (api / RN).
 */
function shouldEmitBoardScanPartial(partial: {
  picks: readonly unknown[];
  totalQualified: number;
}): boolean {
  return partial.picks.length > 0 || partial.totalQualified > 0;
}

test("shouldEmitBoardScanPartial fires for staged picks or qualifying-candidate progress", () => {
  assert.equal(shouldEmitBoardScanPartial({ picks: [{}, {}], totalQualified: 0 }), true);
  assert.equal(shouldEmitBoardScanPartial({ picks: [], totalQualified: 3 }), true);
  assert.equal(shouldEmitBoardScanPartial({ picks: [], totalQualified: 0 }), false);
});

test("prop-wave onPartial must receive combined game+prop scored legs", () => {
  // Regression: onWave previously called emitBoardScanPartial() with no args, so
  // mid-scan props never reached onPartial until boardExhausted final.
  const src = fs.readFileSync(new URL("./boardMarketScanner.ts", import.meta.url), "utf8");
  assert.match(src, /export function shouldEmitBoardScanPartial/);
  assert.match(
    src,
    /onWave:\s*\(combined\)\s*=>\s*\{\s*emitBoardScanPartial\(combined\);/,
  );
  assert.match(src, /const emitBoardScanPartial = \(legs: BoardScoredLeg\[\] = scored\)/);
  assert.match(
    src,
    /if \(shouldEmitBoardScanPartial\(partial\)\) opts\.onPartial\(partial\);/,
  );
});
