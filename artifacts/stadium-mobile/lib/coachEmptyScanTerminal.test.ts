import assert from "node:assert/strict";
import { test } from "node:test";

import {
  mergeBoardScanSnapshot,
  shouldFireEmptyScanTerminal,
} from "./coachEmptyScanTerminal.ts";
import type { FullBoardScanResult } from "./boardMarketScanner.ts";

function scan(partial: Partial<FullBoardScanResult>): FullBoardScanResult {
  return {
    picks: [],
    evalLinesByGame: new Map(),
    gameSimulations: new Map(),
    totalScanned: 0,
    totalQualified: 0,
    staging: { mainQualified: 0, altQualified: 0, mainOnTicket: 0, altOnTicket: 0 },
    note: "",
    ...partial,
  };
}

test("shouldFireEmptyScanTerminal only fires on final zero-output combinator", () => {
  assert.equal(
    shouldFireEmptyScanTerminal(
      scan({
        scanComplete: true,
        combinatorMeta: { source: "final", candidateCount: 0, pickCount: 0 },
      }),
    ),
    true,
  );
  assert.equal(
    shouldFireEmptyScanTerminal(
      scan({
        scanComplete: false,
        combinatorMeta: { source: "preview", candidateCount: 0, pickCount: 0 },
      }),
    ),
    false,
  );
  assert.equal(
    shouldFireEmptyScanTerminal(
      scan({
        scanComplete: true,
        combinatorMeta: { source: "preview", candidateCount: 0, pickCount: 0 },
      }),
    ),
    false,
  );
});

test("mergeBoardScanSnapshot keeps final over preview", () => {
  const finalScan = scan({
    scanComplete: true,
    combinatorMeta: { source: "final", candidateCount: 0, pickCount: 0 },
  });
  const preview = scan({
    scanComplete: false,
    combinatorMeta: { source: "preview", candidateCount: 0, pickCount: 0 },
  });
  assert.equal(mergeBoardScanSnapshot(finalScan, preview), finalScan);
  assert.equal(mergeBoardScanSnapshot(preview, finalScan), finalScan);
});
