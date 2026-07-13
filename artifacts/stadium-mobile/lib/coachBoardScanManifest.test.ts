import assert from "node:assert/strict";
import test from "node:test";
import {
  createCoachBoardScanManifestRecorder,
  formatCoachBoardScanManifest,
} from "./coachBoardScanManifest.ts";
import { coachBoardScanManifestForMessage } from "./coachBoardScanDelivery.ts";
import type { FullBoardScanResult } from "./boardMarketScanner.ts";

test("formatCoachBoardScanManifest lists coverage and gate failures", () => {
  const recorder = createCoachBoardScanManifestRecorder(8);
  recorder.recordMarketFound({
    game: "A @ B",
    market: "Points",
    pick: "Star Over 24.5",
    odds: -110,
    isProp: true,
    player: "Star",
  });
  recorder.recordPropSimBatch(1, false);
  const manifest = recorder.finalize({
    scanComplete: true,
    boardExhausted: true,
    deliveredLegs: 0,
  });
  const text = formatCoachBoardScanManifest(manifest);
  assert.match(text, /Scan manifest/i);
  assert.match(text, /Markets found/i);
  assert.match(text, /single delivery/i);
  assert.match(text, /0 legs delivered/i);
});

test("createCoachBoardScanManifestRecorder tracks prop pool rows", () => {
  const recorder = createCoachBoardScanManifestRecorder(6);
  recorder.recordPropPoolRow({
    game: "A @ B",
    market: "Points",
    pick: "Star Over 20.5 Points",
    odds: -110,
    isProp: true,
    player: "Star",
    sport: "nba",
    propLine: 20.5,
    propSide: "Over",
  });
  assert.equal(recorder.propsFound, 1);
  assert.ok(recorder.propsEligibleForSim + recorder.propsSkippedUnsupported === 1);
});

test("coachBoardScanManifestForMessage returns manifest when scan staged zero legs", () => {
  const scan: FullBoardScanResult = {
    picks: [],
    evalLinesByGame: new Map(),
    gameSimulations: new Map(),
    totalScanned: 1200,
    totalQualified: 0,
    staging: { mainQualified: 0, altQualified: 0, mainOnTicket: 0, altOnTicket: 0 },
    note: "",
    scanComplete: true,
    manifest: createCoachBoardScanManifestRecorder(8).finalize({
      scanComplete: true,
      boardExhausted: true,
      deliveredLegs: 0,
    }),
  };
  const text = coachBoardScanManifestForMessage(scan, { realOdds: [], propPool: [], gameMeta: [] }, 8);
  assert.match(text, /Scan manifest/i);
  assert.match(text, /0 legs delivered/i);
});
