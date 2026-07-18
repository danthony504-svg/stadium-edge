import assert from "node:assert/strict";
import { test } from "node:test";

import {
  readBoardScanFinal,
  stashBoardScanFinal,
} from "./coachBoardScanLifecycle.ts";
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

test("stashBoardScanFinal stores complete scans by requestId", () => {
  const registry = new Map<string, FullBoardScanResult>();
  const finalScan = scan({
    requestId: "req-5",
    scanComplete: true,
    combinatorMeta: { source: "final", candidateCount: 0, pickCount: 0 },
  });
  stashBoardScanFinal(registry, finalScan);
  const read = readBoardScanFinal(registry, "req-5", scan({ scanComplete: false }));
  assert.equal(read?.requestId, "req-5");
  assert.equal(read?.scanComplete, true);
});
